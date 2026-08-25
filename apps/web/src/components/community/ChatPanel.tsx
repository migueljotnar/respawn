import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  ArrowDown,
  Bell,
  Hash,
  Menu,
  MessageSquareText,
  Paperclip,
  Pin,
  Send,
  Smile,
  UsersRound,
  Volume2,
} from "lucide-react";

import type { CommunityChannel } from "../../data/community-mocks.js";
import { ChatSendError, type ChatMessageDto } from "../../lib/chat-ws.js";
import { roleBadgeStyles } from "../../lib/role-badges.js";
import type { ResyncStatus } from "../../stores/chat-store.js";
import type { VoiceConnectionStatus, VoiceParticipant } from "../../stores/voice-store.js";
import { VideoGrid } from "./VideoGrid.js";

interface ChatPanelProps {
  channel: CommunityChannel;
  messages: ChatMessageDto[];
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  historyError: string | null;
  resyncStatus: ResyncStatus;
  onlineCount: number;
  typingUsers: string[];
  currentUserId: string;
  onOpenNavigation: () => void;
  onOpenMembers: () => void;
  onSendMessage: (content: string, clientMessageId: string) => Promise<void>;
  onLoadOlderMessages: () => void;
  onRetryHistory: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onJoinVoice: () => void;
  voiceStatus?: VoiceConnectionStatus;
  voiceError?: string | null;
  voiceParticipants?: VoiceParticipant[];
}

function describeVoiceStatus(
  status: VoiceConnectionStatus,
  error: string | null | undefined,
  participantCount: number,
): string {
  if (status === "connected") {
    return participantCount > 0
      ? `Conectado à sala de voz · ${participantCount} ${participantCount === 1 ? "pessoa" : "pessoas"}.`
      : "Conectado à sala de voz.";
  }

  if (status === "connecting") {
    return "Conectando à sala de voz...";
  }

  if (status === "error") {
    return error ?? "Não foi possível conectar à sala de voz.";
  }

  return "Você não está conectado a esta sala de voz.";
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_THRESHOLD = 160;
const LOAD_OLDER_THRESHOLD = 120;
const TYPING_IDLE_TIMEOUT_MS = 2_000;

function describeSendError(error: unknown): string {
  if (error instanceof ChatSendError) {
    if (error.outcome === "timeout") {
      return "Não foi possível confirmar o envio. Verifique sua conexão.";
    }

    if (error.outcome === "offline") {
      return "Você está offline. A mensagem não foi enviada.";
    }
  }

  return "Não foi possível enviar. Tente novamente.";
}

export const MARKDOWN_PATTERN = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;

export function renderInlineMarkdown(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  MARKDOWN_PATTERN.lastIndex = 0;

  while ((match = MARKDOWN_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-bold text-respawn-ice">
          {match[1]}
        </strong>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <em key={key++} className="italic">
          {match[2]}
        </em>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[13px] text-respawn-neon"
        >
          {match[3]}
        </code>,
      );
    }

    lastIndex = MARKDOWN_PATTERN.lastIndex;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function shouldGroupWithPrevious(
  current: ChatMessageDto,
  previous: ChatMessageDto | undefined,
): boolean {
  if (!previous) return false;
  if (previous.author.id !== current.author.id) return false;
  return (
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUP_WINDOW_MS
  );
}

/**
 * Quantas mensagens da lista atual são de fato novas (id nunca visto) E
 * mais recentes que a última mensagem que já tínhamos antes desta
 * atualização. A segunda condição é o que separa um append real (conta) de
 * um prepend de histórico antigo carregado via scroll infinito (não conta) —
 * sem ela, uma atualização que misturasse os dois inflaria o contador.
 * Extraída como função pura (sem DOM) para poder testar lotes de 1, 2 e 50
 * mensagens sem depender de layout/scroll, que o jsdom não simula de verdade.
 */
export function countNewlyAppendedMessages(
  messages: ChatMessageDto[],
  previousMessageIds: ReadonlySet<string>,
  previousNewestCursor: Pick<ChatMessageDto, "createdAt" | "id"> | undefined,
): number {
  function isAfterPreviousCursor(message: ChatMessageDto): boolean {
    if (!previousNewestCursor) {
      return true;
    }

    const timeDifference =
      new Date(message.createdAt).getTime() -
      new Date(previousNewestCursor.createdAt).getTime();

    return timeDifference > 0 ||
      (timeDifference === 0 && message.id.localeCompare(previousNewestCursor.id) > 0);
  }

  return messages.reduce((count, message) => {
    if (previousMessageIds.has(message.id)) {
      return count;
    }

    return isAfterPreviousCursor(message) ? count + 1 : count;
  }, 0);
}

function MessageRow({
  message,
  compact,
}: {
  message: ChatMessageDto;
  compact: boolean;
}) {
  const authorName = message.author.displayName ?? message.author.username;

  if (compact) {
    return (
      <article className="group flex gap-3 px-4 py-0.5 transition-colors hover:bg-white/[0.025] sm:px-6">
        <div className="grid w-10 shrink-0 place-items-center">
          <time className="hidden text-[9px] text-slate-500 group-hover:block">
            {formatTimestamp(message.createdAt)}
          </time>
        </div>
        <p className="min-w-0 max-w-4xl flex-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-200">
          {renderInlineMarkdown(message.content)}
        </p>
      </article>
    );
  }

  return (
    <article className="group flex gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] sm:px-6">
      <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-respawn-neon/15 to-respawn-purple/20 text-xs font-black text-respawn-ice">
        {getInitials(authorName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-bold text-respawn-ice">{authorName}</h3>
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${roleBadgeStyles[message.author.role]}`}
          >
            {message.author.role}
          </span>
          <time className="text-[10px] text-slate-400">
            {formatTimestamp(message.createdAt)}
          </time>
        </div>
        <p className="mt-1 max-w-4xl whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-200">
          {renderInlineMarkdown(message.content)}
        </p>
      </div>
    </article>
  );
}

export function ChatPanel({
  channel,
  messages,
  isLoadingHistory,
  hasMoreHistory,
  historyError,
  resyncStatus,
  onlineCount,
  typingUsers,
  currentUserId,
  onOpenNavigation,
  onOpenMembers,
  onSendMessage,
  onLoadOlderMessages,
  onRetryHistory,
  onTypingStart,
  onTypingStop,
  onJoinVoice,
  voiceStatus = "disconnected",
  voiceError = null,
  voiceParticipants = [],
}: ChatPanelProps) {
  const voiceParticipantCount = voiceParticipants.filter((participant) => !participant.isLocal).length;
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const ChannelIcon = channel.kind === "voice" ? Volume2 : Hash;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCount = useRef(0);
  const previousLastMessageId = useRef<string | undefined>(undefined);
  const previousScrollHeight = useRef(0);
  const previousMessageIds = useRef<ReadonlySet<string>>(new Set());
  const previousNewestCursor = useRef<
    Pick<ChatMessageDto, "createdAt" | "id"> | undefined
  >(undefined);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const isTypingRef = useRef(false);
  const draftRef = useRef("");
  const retryAttemptRef = useRef<{
    submittedDraft: string;
    clientMessageId: string;
  } | null>(null);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const lastMessage = messages[messages.length - 1];
    const grew = messages.length > previousMessageCount.current;
    const isAppend = grew && lastMessage?.id !== previousLastMessageId.current;
    const isPrepend = grew && lastMessage?.id === previousLastMessageId.current;
    const isInitialLoad = previousMessageCount.current === 0 && messages.length > 0;

    if (isPrepend) {
      container.scrollTop = container.scrollHeight - previousScrollHeight.current;
    } else if (isInitialLoad) {
      container.scrollTop = container.scrollHeight;
    } else if (isAppend) {
      // A proximidade da base é medida contra o scrollHeight de ANTES deste
      // append (capturado no fim do efeito anterior) — o navegador preserva
      // scrollTop quando conteúdo é adicionado abaixo da dobra, então isso
      // reflete corretamente onde o usuário estava olhando.
      const distanceFromBottomBeforeAppend =
        previousScrollHeight.current - container.scrollTop - container.clientHeight;
      const wasNearBottom = distanceFromBottomBeforeAppend < NEAR_BOTTOM_THRESHOLD;
      const isOwnMessage = lastMessage?.author.id === currentUserId;

      if (wasNearBottom || isOwnMessage) {
        container.scrollTop = container.scrollHeight;
        setNewMessageCount(0);
      } else {
        const newlyAppendedCount = countNewlyAppendedMessages(
          messages,
          previousMessageIds.current,
          previousNewestCursor.current,
        );

        if (newlyAppendedCount > 0) {
          setNewMessageCount((count) => count + newlyAppendedCount);
        }
      }
    }

    previousMessageCount.current = messages.length;
    previousLastMessageId.current = lastMessage?.id;
    previousScrollHeight.current = container.scrollHeight;
    previousMessageIds.current = new Set(messages.map((message) => message.id));
    previousNewestCursor.current = lastMessage
      ? { createdAt: lastMessage.createdAt, id: lastMessage.id }
      : undefined;
  }, [messages, currentUserId]);

  useEffect(() => {
    return () => {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = undefined;

      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop();
      }
    };
    // Roda só na montagem/desmontagem: o ChatPanel é remontado por inteiro a
    // cada troca de canal (key={channel.id} no MainLayout), então o
    // onTypingStop capturado aqui já corresponde ao canal certo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTypingActivity(): void {
    window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = undefined;

    if (!isTypingRef.current) {
      return;
    }

    isTypingRef.current = false;
    onTypingStop();
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;

    if (container.scrollTop < LOAD_OLDER_THRESHOLD && hasMoreHistory && !isLoadingHistory) {
      previousScrollHeight.current = container.scrollHeight;
      onLoadOlderMessages();
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distanceFromBottom < NEAR_BOTTOM_THRESHOLD && newMessageCount > 0) {
      setNewMessageCount(0);
    }
  }

  function handleJumpToBottom() {
    const container = scrollRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }

    setNewMessageCount(0);
  }

  function handleDraftChange(value: string) {
    draftRef.current = value;

    // O id idempotente pertence a tentativa que falhou, nao ao texto para
    // sempre. Qualquer edicao abandona aquela tentativa.
    if (
      retryAttemptRef.current &&
      retryAttemptRef.current.submittedDraft !== value
    ) {
      retryAttemptRef.current = null;
    }

    setDraft(value);
    setSendError(null);

    if (value.trim().length > 0) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        onTypingStart();
      }

      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        typingTimeoutRef.current = undefined;

        if (isTypingRef.current) {
          isTypingRef.current = false;
          onTypingStop();
        }
      }, TYPING_IDLE_TIMEOUT_MS);
    } else {
      stopTypingActivity();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDraft = draft;
    const content = submittedDraft.trim();

    if (!content || isSending) return;

    const retryAttempt = retryAttemptRef.current;
    const clientMessageId =
      retryAttempt?.submittedDraft === submittedDraft
        ? retryAttempt.clientMessageId
        : crypto.randomUUID();
    retryAttemptRef.current = null;

    stopTypingActivity();
    setIsSending(true);
    setSendError(null);

    try {
      await onSendMessage(content, clientMessageId);
      // Só limpa o rascunho se ele ainda for exatamente o texto que acabou
      // de ser enviado — se o usuário já apagou/editou enquanto o ACK
      // estava pendente, o que ele digitou depois não é descartado.
      setDraft((current) => {
        if (current !== submittedDraft) {
          return current;
        }

        draftRef.current = "";
        return "";
      });
      setAnnouncement(`Mensagem enviada em ${channel.name}.`);
    } catch (error) {
      if (draftRef.current === submittedDraft) {
        retryAttemptRef.current = { submittedDraft, clientMessageId };
        setSendError(describeSendError(error));
      }
      // Preserva o rascunho para o usuário não perder o texto em caso de
      // timeout/desconexão/sessão inválida.
    } finally {
      setIsSending(false);
    }
  }

  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0]} está digitando...`
        : typingUsers.length === 2
          ? `${typingUsers[0]} e ${typingUsers[1]} estão digitando...`
          : `${typingUsers.length} pessoas estão digitando...`;

  const synchronizationNeedsRetry =
    resyncStatus === "error" || resyncStatus === "incomplete";
  const historyProblem =
    historyError ??
    (resyncStatus === "incomplete"
      ? "A sincronização foi interrompida antes de terminar."
      : synchronizationNeedsRetry
        ? "Não foi possível sincronizar as mensagens."
        : null);

  return (
    <main
      aria-labelledby="active-channel-title"
      className="community-grid flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-respawn-base"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-respawn-base/95 px-2 backdrop-blur-xl sm:px-4">
        <button
          type="button"
          onClick={onOpenNavigation}
          aria-label="Abrir servidores e canais"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-300 outline-none transition-colors hover:bg-white/[0.05] hover:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <ChannelIcon className="h-5 w-5 shrink-0 text-respawn-neon" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 id="active-channel-title" className="truncate text-sm font-extrabold text-respawn-ice sm:text-base">
              {channel.kind === "text" ? `#${channel.name}` : channel.name}
            </h1>
          </div>
          <p className="truncate text-[11px] text-slate-400 sm:text-xs">{channel.topic}</p>
        </div>

        <div className="hidden items-center gap-3 text-slate-400 lg:flex" aria-hidden="true">
          <Bell className="h-[18px] w-[18px]" />
          <Pin className="h-[18px] w-[18px]" />
          <span className="h-5 w-px bg-white/10" />
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-respawn-neon" /> {onlineCount} online
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenMembers}
          aria-label="Abrir lista de membros"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-300 outline-none transition-colors hover:bg-white/[0.05] hover:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon xl:hidden"
        >
          <UsersRound className="h-5 w-5" />
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-5"
      >
        <section className="px-4 pb-6 sm:px-6" aria-labelledby="channel-intro-title">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-respawn-neon/20 bg-respawn-neon/[0.07] text-respawn-neon shadow-neon-soft">
            <ChannelIcon className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 id="channel-intro-title" className="mt-4 font-display text-2xl tracking-tight text-respawn-ice sm:text-3xl">
            {channel.kind === "text" ? `Bem-vindo a #${channel.name}` : channel.name}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            {channel.description}
          </p>
          {channel.kind === "voice" ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 rounded-xl border border-respawn-purple/20 bg-respawn-purple/[0.07] px-3 py-2 text-xs text-purple-200"
              >
                <Volume2 className="h-4 w-4" />
                {describeVoiceStatus(voiceStatus, voiceError, voiceParticipantCount)}
              </div>
              {voiceStatus === "disconnected" || voiceStatus === "error" ? (
                <button
                  type="button"
                  onClick={onJoinVoice}
                  className="rounded-xl border border-respawn-neon/40 bg-respawn-neon/10 px-3 py-2 text-xs font-bold text-respawn-neon outline-none transition-colors hover:bg-respawn-neon/20 focus-visible:ring-2 focus-visible:ring-respawn-neon"
                >
                  {voiceStatus === "error" ? "Tentar novamente" : "Entrar no canal de voz"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {channel.kind === "voice" ? <VideoGrid participants={voiceParticipants} /> : null}

        {channel.kind === "text" && historyProblem ? (
          <div
            role="alert"
            className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-xs text-red-100 sm:mx-6"
          >
            <span>{historyProblem}</span>
            <button
              type="button"
              onClick={onRetryHistory}
              className="shrink-0 rounded-lg border border-red-300/30 px-2.5 py-1 font-bold text-red-100 outline-none hover:bg-red-300/10 focus-visible:ring-2 focus-visible:ring-red-200"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        {hasMoreHistory || isLoadingHistory ? (
          <p className="px-4 pb-3 text-center text-[10px] uppercase tracking-digital text-slate-500 sm:px-6">
            {isLoadingHistory ? "Carregando histórico..." : "Role para cima para ver mais"}
          </p>
        ) : null}

        <div className="flex items-center gap-3 px-4 pb-3 sm:px-6" aria-hidden="true">
          <span className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-[10px] font-bold uppercase tracking-digital text-slate-400">
            Hoje
          </span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>

        <section aria-label={`Mensagens de ${channel.name}`}>
          {messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              compact={shouldGroupWithPrevious(message, messages[index - 1])}
            />
          ))}
        </section>
      </div>

      {newMessageCount > 0 ? (
        <div className="flex shrink-0 justify-center px-3">
          <button
            type="button"
            onClick={handleJumpToBottom}
            className="mb-2 flex items-center gap-1.5 rounded-full bg-respawn-neon px-3 py-1.5 text-xs font-bold text-respawn-base shadow-neon-soft transition-transform hover:-translate-y-0.5"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {newMessageCount} {newMessageCount === 1 ? "nova mensagem" : "novas mensagens"}
          </button>
        </div>
      ) : null}

      {channel.kind === "text" ? (
        <div className="shrink-0 px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
        <p
          className="mb-1 h-4 px-2 text-[11px] italic text-respawn-neon/90"
          aria-live="polite"
        >
          {typingLabel}
        </p>
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-500 bg-respawn-panel/95 p-2 shadow-[0_-12px_40px_rgba(0,0,0,0.18)] transition-colors focus-within:border-respawn-neon/70 focus-within:shadow-neon-soft"
        >
          <div className="flex items-center gap-1.5">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400"
              aria-hidden="true"
            >
              <Paperclip className="h-5 w-5" />
            </span>
            <label htmlFor="chat-message" className="sr-only">
              Mensagem para {channel.name}
            </label>
            <input
              id="chat-message"
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              autoComplete="off"
              maxLength={500}
              aria-describedby="composer-note"
              placeholder={`Conversar em ${channel.kind === "text" ? `#${channel.name}` : channel.name}`}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-sm text-respawn-ice outline-none placeholder:text-slate-400"
            />
            <Smile className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
            <button
              type="submit"
              disabled={!draft.trim() || isSending}
              aria-label="Enviar mensagem"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-respawn-neon text-respawn-base shadow-neon-soft outline-none transition-all hover:-translate-y-0.5 hover:bg-[#68FFA2] focus-visible:ring-2 focus-visible:ring-respawn-ice disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 px-2 pb-0.5 pt-1">
            <p
              id="composer-note"
              className={`flex min-w-0 items-center gap-1.5 truncate text-[10px] ${sendError ? "text-red-300" : "text-slate-400"}`}
            >
              <MessageSquareText className="h-3 w-3 shrink-0 text-respawn-purple" aria-hidden="true" />
              {sendError ?? "Negrito com **texto**, itálico com *texto* e código com `texto`."}
            </p>
            <span className="hidden text-[10px] text-slate-400 sm:inline">
              {draft.length}/500
            </span>
          </div>
        </form>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </main>
  );
}
