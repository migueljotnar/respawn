import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessageDto } from "../lib/chat-ws.js";

const listMessagesMock = vi.fn<
  (channelSlug: string, options?: Record<string, unknown>) => Promise<ChatMessageDto[]>
>();
const listMembersMock = vi.fn();

vi.mock("../lib/chat-api.js", () => ({
  chatApi: {
    listMessages: listMessagesMock,
    listMembers: listMembersMock,
  },
}));

function makeMessage(id: string, createdAt: string, content = id): ChatMessageDto {
  return {
    id,
    channelSlug: "chat-geral",
    content,
    createdAt,
    author: {
      id: "author-1",
      username: "someone",
      displayName: null,
      avatarUrl: null,
      role: "NOVATO",
    },
  };
}

// Importado depois do vi.mock acima para garantir que o módulo mockado é o
// que a store efetivamente usa.
const { useChatStore, mergeMessages } = await import("./chat-store.js");

beforeEach(() => {
  listMessagesMock.mockReset();
  listMembersMock.mockReset();
  useChatStore.setState({
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
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mergeMessages", () => {
  it("deduplica por id, mantendo a versão mais recente informada", () => {
    const existing = [makeMessage("a", "2026-01-01T00:00:00.000Z", "original")];
    const incoming = [makeMessage("a", "2026-01-01T00:00:00.000Z", "atualizada")];

    const result = mergeMessages(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("atualizada");
  });

  it("ordena por createdAt e usa o id como critério de desempate", () => {
    const existing = [makeMessage("b", "2026-01-01T00:00:02.000Z")];
    const incoming = [
      makeMessage("a", "2026-01-01T00:00:01.000Z"),
      makeMessage("c", "2026-01-01T00:00:02.000Z"),
    ];

    const result = mergeMessages(existing, incoming);

    expect(result.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("loadInitialMessages", () => {
  it("reconsulta um canal com cache vazio ao reabri-lo", async () => {
    const channelSlug = "chat-geral";
    const firstMessage = makeMessage("m1", "2026-01-01T00:00:00.000Z");
    useChatStore.setState({ messagesByChannel: { [channelSlug]: [] } });
    listMessagesMock.mockResolvedValueOnce([firstMessage]);

    await useChatStore.getState().loadInitialMessages(channelSlug);

    expect(listMessagesMock).toHaveBeenCalledWith(channelSlug, { limit: 50 });
    expect(useChatStore.getState().messagesByChannel[channelSlug]).toEqual([firstMessage]);
  });

  it("ignora erro e finally de uma carga antiga depois que uma nova carga venceu", async () => {
    const channelSlug = "chat-geral";
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (messages: ChatMessageDto[]) => void;
    const oldRequest = new Promise<ChatMessageDto[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    const newRequest = new Promise<ChatMessageDto[]>((resolve) => {
      resolveNew = resolve;
    });
    listMessagesMock
      .mockImplementationOnce(() => oldRequest)
      .mockImplementationOnce(() => newRequest);

    const oldLoad = useChatStore.getState().loadInitialMessages(channelSlug);
    const newLoad = useChatStore.getState().loadInitialMessages(channelSlug);

    resolveNew([]);
    await newLoad;
    rejectOld(new Error("falha obsoleta"));
    await oldLoad;

    expect(useChatStore.getState().historyErrorByChannel[channelSlug]).toBeNull();
    expect(useChatStore.getState().loadingHistoryByChannel[channelSlug]).toBe(false);
  });
});

describe("resyncChannel", () => {
  it(
    "usa um cursor local estável — uma mensagem ao vivo chegando entre páginas não faz o " +
      "cursor pular parte do backlog (QA-F2-003)",
    async () => {
      const channelSlug = "chat-geral";
      const m1 = makeMessage("m1", "2026-01-01T00:00:00.000Z");
      useChatStore.setState({ messagesByChannel: { [channelSlug]: [m1] } });

      const page1 = Array.from({ length: 50 }, (_unused, index) =>
        makeMessage(`page1-${index}`, `2026-01-01T00:01:${String(index).padStart(2, "0")}.000Z`),
      );

      listMessagesMock.mockImplementationOnce(async () => {
        // Simula uma mensagem ao vivo chegando bem no meio da paginação —
        // com o bug antigo, o próximo cursor seria recalculado a partir
        // desta mensagem (a mais nova do store), pulando as 50 da page1.
        const live = makeMessage("live-message", "2026-06-01T00:00:00.000Z");
        useChatStore.getState().receiveMessage(live);
        return page1;
      });
      listMessagesMock.mockImplementationOnce(async () => []);

      await useChatStore.getState().resyncChannel(channelSlug);

      expect(listMessagesMock).toHaveBeenCalledTimes(2);
      // A segunda chamada usa o cursor da ÚLTIMA mensagem da page1 — nunca a
      // mensagem "live-message" injetada no meio.
      const secondCallArgs = listMessagesMock.mock.calls[1]!;
      expect(secondCallArgs[1]).toMatchObject({
        afterId: "page1-49",
      });

      const finalMessages = useChatStore.getState().messagesByChannel[channelSlug] ?? [];
      const finalIds = finalMessages.map((m) => m.id);
      expect(finalIds).toContain("m1");
      expect(finalIds).toContain("page1-0");
      expect(finalIds).toContain("page1-49");
      expect(finalIds).toContain("live-message");
      expect(finalIds).toHaveLength(52);
      expect(useChatStore.getState().resyncStatusByChannel[channelSlug]).toBe("complete");
    },
  );

  it("sincroniza um backlog de mais de 250 mensagens sem parar no limite antigo de 5 páginas", async () => {
    const channelSlug = "chat-geral";
    const m1 = makeMessage("m1", "2026-01-01T00:00:00.000Z");
    useChatStore.setState({ messagesByChannel: { [channelSlug]: [m1] } });

    const TOTAL_PAGES = 6; // 6 * 50 = 300 mensagens, acima do teto antigo de 250
    let callIndex = 0;

    listMessagesMock.mockImplementation(async () => {
      if (callIndex >= TOTAL_PAGES) {
        return [];
      }

      const pageIndex = callIndex;
      callIndex += 1;

      return Array.from({ length: 50 }, (_unused, index) =>
        makeMessage(
          `p${pageIndex}-${index}`,
          `2026-01-0${pageIndex + 2}T00:${String(index).padStart(2, "0")}:00.000Z`,
        ),
      );
    });

    await useChatStore.getState().resyncChannel(channelSlug);

    const finalMessages = useChatStore.getState().messagesByChannel[channelSlug] ?? [];
    expect(finalMessages).toHaveLength(1 + TOTAL_PAGES * 50);
    expect(useChatStore.getState().resyncStatusByChannel[channelSlug]).toBe("complete");
  });

  it("não faz nada quando o canal ainda não tem nenhuma mensagem conhecida", async () => {
    await useChatStore.getState().resyncChannel("canal-vazio");
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it("envia cursor composto createdAt + id quando mensagens compartilham timestamp", async () => {
    const channelSlug = "chat-geral";
    const timestamp = "2026-01-01T00:00:00.000Z";
    useChatStore.setState({
      messagesByChannel: {
        [channelSlug]: [makeMessage("m-middle", timestamp)],
      },
    });
    listMessagesMock.mockResolvedValueOnce([makeMessage("m-next", timestamp)]);

    await useChatStore.getState().resyncChannel(channelSlug);

    expect(listMessagesMock).toHaveBeenCalledWith(channelSlug, {
      limit: 50,
      afterCreatedAt: timestamp,
      afterId: "m-middle",
    });
    expect(
      useChatStore.getState().messagesByChannel[channelSlug]?.map((message) => message.id),
    ).toEqual(["m-middle", "m-next"]);
  });

  it("expõe erro de resync e o limpa após retry bem-sucedido", async () => {
    const channelSlug = "chat-geral";
    useChatStore.setState({
      messagesByChannel: {
        [channelSlug]: [makeMessage("m1", "2026-01-01T00:00:00.000Z")],
      },
    });
    listMessagesMock.mockRejectedValueOnce(new Error("resync indisponível"));

    await useChatStore.getState().resyncChannel(channelSlug);
    expect(useChatStore.getState().resyncStatusByChannel[channelSlug]).toBe("error");
    expect(useChatStore.getState().historyErrorByChannel[channelSlug]).toBe(
      "resync indisponível",
    );

    listMessagesMock.mockResolvedValueOnce([]);
    await useChatStore.getState().resyncChannel(channelSlug);

    expect(useChatStore.getState().resyncStatusByChannel[channelSlug]).toBe("complete");
    expect(useChatStore.getState().historyErrorByChannel[channelSlug]).toBeNull();
  });

  it("ignora falha de resync antiga depois que uma sincronizacao nova terminou", async () => {
    const channelSlug = "chat-geral";
    const cursor = makeMessage("m1", "2026-01-01T00:00:00.000Z");
    let rejectOld!: (reason: Error) => void;
    const oldRequest = new Promise<ChatMessageDto[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    useChatStore.setState({ messagesByChannel: { [channelSlug]: [cursor] } });
    listMessagesMock
      .mockImplementationOnce(() => oldRequest)
      .mockResolvedValueOnce([]);

    const oldResync = useChatStore.getState().resyncChannel(channelSlug);
    await useChatStore.getState().resyncChannel(channelSlug);
    rejectOld(new Error("resync obsoleto"));
    await oldResync;

    expect(useChatStore.getState().resyncStatusByChannel[channelSlug]).toBe("complete");
    expect(useChatStore.getState().historyErrorByChannel[channelSlug]).toBeNull();
  });
});

describe("tratamento de rejeições REST (histórico e membros)", () => {
  it("loadInitialMessages nunca rejeita, mesmo quando a API falha, e guarda o erro no estado", async () => {
    listMessagesMock.mockRejectedValueOnce(new Error("falha de rede simulada"));

    await expect(useChatStore.getState().loadInitialMessages("chat-geral")).resolves.toBeUndefined();

    expect(useChatStore.getState().historyErrorByChannel["chat-geral"]).toBe(
      "falha de rede simulada",
    );
    expect(useChatStore.getState().loadingHistoryByChannel["chat-geral"]).toBe(false);
  });

  it("loadOlderMessages nunca rejeita, mesmo quando a API falha, e guarda o erro no estado", async () => {
    const channelSlug = "chat-geral";
    useChatStore.setState({
      messagesByChannel: { [channelSlug]: [makeMessage("m1", "2026-01-01T00:00:00.000Z")] },
      hasMoreByChannel: { [channelSlug]: true },
    });
    listMessagesMock.mockRejectedValueOnce(new Error("timeout simulado"));

    await expect(useChatStore.getState().loadOlderMessages(channelSlug)).resolves.toBeUndefined();

    expect(useChatStore.getState().historyErrorByChannel[channelSlug]).toBe("timeout simulado");
  });

  it("loadMembers nunca rejeita, mesmo quando a API falha, e guarda o erro em membersError", async () => {
    listMembersMock.mockRejectedValueOnce(new Error("403 simulado"));

    await expect(useChatStore.getState().loadMembers()).resolves.toBeUndefined();

    expect(useChatStore.getState().membersError).toBe("403 simulado");
    expect(useChatStore.getState().members).toEqual([]);
  });
});

describe("applyTypingUpdate — TTL defensivo", () => {
  it("limpa sozinho um indicador de digitando preso se nenhum stop chegar", () => {
    vi.useFakeTimers();

    useChatStore.getState().applyTypingUpdate({
      channelSlug: "chat-geral",
      userId: "user-1",
      username: "Fulano",
      typing: true,
    });

    expect(useChatStore.getState().typingByChannel["chat-geral"]?.["user-1"]).toBe("Fulano");

    vi.advanceTimersByTime(5_000);

    expect(useChatStore.getState().typingByChannel["chat-geral"]?.["user-1"]).toBeUndefined();
  });
});
