import { create } from "zustand";

import { chatApi, type ChatMemberDto } from "../lib/chat-api.js";
import type { ChatMessageDto, PresenceUpdate, TypingUpdate } from "../lib/chat-ws.js";

const HISTORY_PAGE_SIZE = 50;
const TYPING_TTL_MS = 4_000;
// Segurança contra um loop realmente infinito (ex.: bug no cursor do
// servidor) — não é o limite de backlog em si, que agora é "até acabar".
// 1000 páginas de 50 cobrem 50 mil mensagens perdidas numa única
// reconexão, bem além de qualquer cenário realista de tempo offline.
const MAX_RESYNC_ITERATIONS = 1_000;

export type ResyncStatus = "idle" | "syncing" | "complete" | "incomplete" | "error";

const DEFAULT_HISTORY_ERROR = "Não foi possível carregar as mensagens.";
const DEFAULT_MEMBERS_ERROR = "Não foi possível carregar a lista de membros.";

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function mergeMessages(
  existing: ChatMessageDto[],
  incoming: ChatMessageDto[],
): ChatMessageDto[] {
  if (incoming.length === 0) {
    return existing;
  }

  const byId = new Map(existing.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

// Timeouts de TTL do "digitando..." não fazem parte do estado reativo da
// store — vivem à parte, indexados por canal+usuário, e só disparam um
// `set()` quando de fato precisam limpar um indicador preso.
const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

interface ChatState {
  messagesByChannel: Record<string, ChatMessageDto[]>;
  hasMoreByChannel: Record<string, boolean>;
  loadingHistoryByChannel: Record<string, boolean>;
  loadGenerationByChannel: Record<string, number>;
  resyncGenerationByChannel: Record<string, number>;
  historyErrorByChannel: Record<string, string | null>;
  resyncStatusByChannel: Record<string, ResyncStatus>;
  typingByChannel: Record<string, Record<string, string>>;
  onlineUserIds: Set<string>;
  members: ChatMemberDto[];
  membersError: string | null;

  invalidateChannelOperations: (channelSlug: string) => void;
  loadInitialMessages: (channelSlug: string) => Promise<void>;
  loadOlderMessages: (channelSlug: string) => Promise<void>;
  resyncChannel: (
    channelSlug: string,
    startingCursor?: Pick<ChatMessageDto, "createdAt" | "id">,
  ) => Promise<void>;
  receiveMessage: (message: ChatMessageDto) => void;
  applyTypingUpdate: (update: TypingUpdate) => void;
  clearTypingForUser: (channelSlug: string, userId: string) => void;
  setInitialPresence: (onlineUserIds: string[]) => void;
  applyPresenceUpdate: (update: PresenceUpdate) => void;
  loadMembers: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesByChannel: {},
  hasMoreByChannel: {},
  loadingHistoryByChannel: {},
  loadGenerationByChannel: {},
  resyncGenerationByChannel: {},
  historyErrorByChannel: {},
  resyncStatusByChannel: {},
  typingByChannel: {},
  onlineUserIds: new Set(),
  members: [],
  membersError: null,

  invalidateChannelOperations(channelSlug) {
    set((state) => ({
      loadingHistoryByChannel: {
        ...state.loadingHistoryByChannel,
        [channelSlug]: false,
      },
      loadGenerationByChannel: {
        ...state.loadGenerationByChannel,
        [channelSlug]: (state.loadGenerationByChannel[channelSlug] ?? 0) + 1,
      },
      resyncGenerationByChannel: {
        ...state.resyncGenerationByChannel,
        [channelSlug]: (state.resyncGenerationByChannel[channelSlug] ?? 0) + 1,
      },
    }));
  },

  async loadInitialMessages(channelSlug) {
    const cachedMessages = get().messagesByChannel[channelSlug];
    const generation = (get().loadGenerationByChannel[channelSlug] ?? 0) + 1;

    // Um cache vazio não é um cursor de resync: mensagens podem ter chegado
    // enquanto o usuário estava em outro canal. Reconsultar a página inicial
    // ao reabrir esse canal é a única forma de descobrir a primeira mensagem.
    if (cachedMessages && cachedMessages.length > 0) {
      set((state) => ({
        loadingHistoryByChannel: {
          ...state.loadingHistoryByChannel,
          [channelSlug]: false,
        },
        loadGenerationByChannel: {
          ...state.loadGenerationByChannel,
          [channelSlug]: generation,
        },
      }));
      return;
    }

    set((state) => ({
      loadingHistoryByChannel: { ...state.loadingHistoryByChannel, [channelSlug]: true },
      loadGenerationByChannel: { ...state.loadGenerationByChannel, [channelSlug]: generation },
      historyErrorByChannel: { ...state.historyErrorByChannel, [channelSlug]: null },
    }));

    try {
      const messages = await chatApi.listMessages(channelSlug, {
        limit: HISTORY_PAGE_SIZE,
      });

      // Uma chamada mais nova (outro loadInitialMessages/resync) já assumiu
      // este canal enquanto esta requisição estava em voo — não pisar nela.
      if (get().loadGenerationByChannel[channelSlug] !== generation) {
        return;
      }

      set((state) =>
        state.loadGenerationByChannel[channelSlug] === generation
          ? {
              messagesByChannel: {
                ...state.messagesByChannel,
                [channelSlug]: mergeMessages(
                  state.messagesByChannel[channelSlug] ?? [],
                  messages,
                ),
              },
              hasMoreByChannel: {
                ...state.hasMoreByChannel,
                [channelSlug]: messages.length === HISTORY_PAGE_SIZE,
              },
            }
          : state,
      );
    } catch (error) {
      // Nunca deixamos esta promise rejeitar: quem chama normalmente faz
      // `void loadInitialMessages(...)` sem .catch, então uma rejeição aqui
      // seria uma unhandled rejection. O erro fica visível via
      // historyErrorByChannel para quem quiser mostrar algo na UI.
      set((state) =>
        state.loadGenerationByChannel[channelSlug] === generation
          ? {
              historyErrorByChannel: {
                ...state.historyErrorByChannel,
                [channelSlug]: describeError(error, DEFAULT_HISTORY_ERROR),
              },
            }
          : state,
      );
    } finally {
      set((state) =>
        state.loadGenerationByChannel[channelSlug] === generation
          ? {
              loadingHistoryByChannel: {
                ...state.loadingHistoryByChannel,
                [channelSlug]: false,
              },
            }
          : state,
      );
    }
  },

  async loadOlderMessages(channelSlug) {
    const state = get();
    const existing = state.messagesByChannel[channelSlug] ?? [];
    const oldest = existing[0];

    if (
      !oldest ||
      state.loadingHistoryByChannel[channelSlug] ||
      state.hasMoreByChannel[channelSlug] === false
    ) {
      return;
    }

    const generation = (state.loadGenerationByChannel[channelSlug] ?? 0) + 1;

    set((current) => ({
      loadingHistoryByChannel: { ...current.loadingHistoryByChannel, [channelSlug]: true },
      loadGenerationByChannel: {
        ...current.loadGenerationByChannel,
        [channelSlug]: generation,
      },
      historyErrorByChannel: { ...current.historyErrorByChannel, [channelSlug]: null },
    }));

    try {
      const olderMessages = await chatApi.listMessages(channelSlug, {
        limit: HISTORY_PAGE_SIZE,
        beforeCreatedAt: oldest.createdAt,
        beforeId: oldest.id,
      });

      set((current) =>
        current.loadGenerationByChannel[channelSlug] === generation
          ? {
              messagesByChannel: {
                ...current.messagesByChannel,
                [channelSlug]: mergeMessages(
                  current.messagesByChannel[channelSlug] ?? [],
                  olderMessages,
                ),
              },
              hasMoreByChannel: {
                ...current.hasMoreByChannel,
                [channelSlug]: olderMessages.length === HISTORY_PAGE_SIZE,
              },
            }
          : current,
      );
    } catch (error) {
      set((current) =>
        current.loadGenerationByChannel[channelSlug] === generation
          ? {
              historyErrorByChannel: {
                ...current.historyErrorByChannel,
                [channelSlug]: describeError(error, DEFAULT_HISTORY_ERROR),
              },
            }
          : current,
      );
    } finally {
      set((current) =>
        current.loadGenerationByChannel[channelSlug] === generation
          ? {
              loadingHistoryByChannel: {
                ...current.loadingHistoryByChannel,
                [channelSlug]: false,
              },
            }
          : current,
      );
    }
  },

  /**
   * Busca mensagens que possam ter chegado enquanto o socket estava
   * desconectado (queda de rede, reinício da API). O cursor é uma variável
   * LOCAL, avançada só pela última mensagem de cada página HTTP — nunca
   * pela "mensagem mais recente do store global", que pode ter avançado
   * sozinha se um message:new ao vivo chegou no meio da paginação (isso
   * fazia o cursor "saltar" e pular parte do backlog). O merge por id
   * continua garantindo que eventos ao vivo recebidos nesse meio-tempo não
   * são perdidos nem duplicados.
   */
  async resyncChannel(channelSlug, startingCursor) {
    const generation = (get().resyncGenerationByChannel[channelSlug] ?? 0) + 1;
    const initial = get().messagesByChannel[channelSlug];
    let cursor = startingCursor ?? initial?.[initial.length - 1];

    // A geracao avanca mesmo sem cursor. Assim uma sincronizacao nova de um
    // canal ainda vazio invalida respostas antigas que ficaram em voo antes
    // de uma reconexao.
    set((state) => ({
      resyncGenerationByChannel: {
        ...state.resyncGenerationByChannel,
        [channelSlug]: generation,
      },
      resyncStatusByChannel: {
        ...state.resyncStatusByChannel,
        [channelSlug]: cursor ? "syncing" : "complete",
      },
      historyErrorByChannel: { ...state.historyErrorByChannel, [channelSlug]: null },
    }));

    if (!cursor) {
      return;
    }

    for (let iteration = 0; iteration < MAX_RESYNC_ITERATIONS; iteration++) {
      let newerMessages: ChatMessageDto[];

      try {
        newerMessages = await chatApi.listMessages(channelSlug, {
          limit: HISTORY_PAGE_SIZE,
          afterCreatedAt: cursor.createdAt,
          afterId: cursor.id,
        });
      } catch (error) {
        set((state) =>
          state.resyncGenerationByChannel[channelSlug] === generation
            ? {
                resyncStatusByChannel: {
                  ...state.resyncStatusByChannel,
                  [channelSlug]: "error",
                },
                historyErrorByChannel: {
                  ...state.historyErrorByChannel,
                  [channelSlug]: describeError(error, DEFAULT_HISTORY_ERROR),
                },
              }
            : state,
        );
        return;
      }

      if (newerMessages.length === 0) {
        set((state) =>
          state.resyncGenerationByChannel[channelSlug] === generation
            ? {
                resyncStatusByChannel: {
                  ...state.resyncStatusByChannel,
                  [channelSlug]: "complete",
                },
              }
            : state,
        );
        return;
      }

      // Mesmo uma geracao antiga ainda pode contribuir mensagens: o merge e
      // comutativo/idempotente por id e o cursor local dela pode estar
      // percorrendo um trecho que a sincronizacao nova ainda nao viu. Apenas
      // status/erro pertencem exclusivamente a geracao mais recente.
      set((state) => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelSlug]: mergeMessages(
            state.messagesByChannel[channelSlug] ?? [],
            newerMessages,
          ),
        },
      }));

      cursor = newerMessages[newerMessages.length - 1]!;

      if (newerMessages.length < HISTORY_PAGE_SIZE) {
        set((state) =>
          state.resyncGenerationByChannel[channelSlug] === generation
            ? {
                resyncStatusByChannel: {
                  ...state.resyncStatusByChannel,
                  [channelSlug]: "complete",
                },
              }
            : state,
        );
        return;
      }
    }

    // Só é alcançado se o teto de segurança realmente disparar — o estado
    // explícito "incomplete" permite que uma chamada futura (próxima
    // reconexão, ou uma ação manual de "sincronizar mais") continue de onde
    // parou, em vez de fingir silenciosamente que terminou.
    set((state) =>
      state.resyncGenerationByChannel[channelSlug] === generation
        ? {
            resyncStatusByChannel: {
              ...state.resyncStatusByChannel,
              [channelSlug]: "incomplete",
            },
          }
        : state,
    );
  },

  receiveMessage(message) {
    set((state) => ({
      messagesByChannel: {
        ...state.messagesByChannel,
        [message.channelSlug]: mergeMessages(
          state.messagesByChannel[message.channelSlug] ?? [],
          [message],
        ),
      },
    }));
  },

  applyTypingUpdate(update) {
    const key = `${update.channelSlug}:${update.userId}`;
    const existingTimeout = typingTimeouts.get(key);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
      typingTimeouts.delete(key);
    }

    set((state) => {
      const channelTyping = { ...(state.typingByChannel[update.channelSlug] ?? {}) };

      if (update.typing) {
        channelTyping[update.userId] = update.username;
      } else {
        delete channelTyping[update.userId];
      }

      return {
        typingByChannel: { ...state.typingByChannel, [update.channelSlug]: channelTyping },
      };
    });

    // Defesa extra contra indicadores presos: se nenhum typing:stop (nem
    // disconnect) chegar depois disso, o TTL limpa sozinho.
    if (update.typing) {
      const timeout = setTimeout(() => {
        typingTimeouts.delete(key);
        get().clearTypingForUser(update.channelSlug, update.userId);
      }, TYPING_TTL_MS);
      typingTimeouts.set(key, timeout);
    }
  },

  clearTypingForUser(channelSlug, userId) {
    const key = `${channelSlug}:${userId}`;
    const existingTimeout = typingTimeouts.get(key);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
      typingTimeouts.delete(key);
    }

    set((state) => {
      const channelTyping = state.typingByChannel[channelSlug];

      if (!channelTyping || !(userId in channelTyping)) {
        return state;
      }

      const nextChannelTyping = { ...channelTyping };
      delete nextChannelTyping[userId];

      return {
        typingByChannel: { ...state.typingByChannel, [channelSlug]: nextChannelTyping },
      };
    });
  },

  setInitialPresence(onlineUserIds) {
    set({ onlineUserIds: new Set(onlineUserIds) });
  },

  applyPresenceUpdate(update) {
    set((state) => {
      const next = new Set(state.onlineUserIds);

      if (update.online) {
        next.add(update.userId);
      } else {
        next.delete(update.userId);
      }

      return { onlineUserIds: next };
    });
  },

  async loadMembers() {
    set({ membersError: null });

    try {
      const members = await chatApi.listMembers();
      set({ members });
    } catch (error) {
      set({ membersError: describeError(error, DEFAULT_MEMBERS_ERROR) });
    }
  },
}));
