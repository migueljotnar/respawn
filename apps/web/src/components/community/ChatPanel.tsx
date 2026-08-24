import { useState, type FormEvent } from "react";
import {
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

import type {
  CommunityChannel,
  MemberRole,
  MockMessage,
} from "../../data/community-mocks.js";

interface ChatPanelProps {
  channel: CommunityChannel;
  messages: MockMessage[];
  onOpenNavigation: () => void;
  onOpenMembers: () => void;
  onSendLocalMessage: (content: string) => void;
}

const roleStyles: Record<MemberRole, string> = {
  MOD: "border-respawn-neon/25 bg-respawn-neon/[0.07] text-respawn-neon",
  VETERAN: "border-respawn-purple/30 bg-respawn-purple/[0.08] text-purple-200",
  PLAYER: "border-slate-500/50 bg-slate-500/10 text-slate-300",
};

function MessageRow({ message }: { message: MockMessage }) {
  return (
    <article className="group flex gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] sm:px-6">
      <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-respawn-neon/15 to-respawn-purple/20 text-xs font-black text-respawn-ice">
        {message.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-bold text-respawn-ice">{message.author}</h3>
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${roleStyles[message.role]}`}
          >
            {message.role}
          </span>
          <time className="text-[10px] text-slate-400">{message.timestamp}</time>
          {message.isLocal ? (
            <span className="text-[9px] font-bold uppercase tracking-wider text-respawn-neon">
              simulação local
            </span>
          ) : null}
        </div>
        <p className="mt-1 max-w-4xl whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-200">
          {message.content}
        </p>
        {message.reactions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Reações demonstrativas">
            {message.reactions.map((reaction) => (
              <span
                key={`${reaction.emoji}-${reaction.count}`}
                className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-white/10 bg-respawn-panel/70 px-2 text-xs text-slate-300"
              >
                {reaction.emoji}
                <span className="font-bold">{reaction.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ChatPanel({
  channel,
  messages,
  onOpenNavigation,
  onOpenMembers,
  onSendLocalMessage,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const ChannelIcon = channel.kind === "voice" ? Volume2 : Hash;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();

    if (!content) return;

    onSendLocalMessage(content);
    setDraft("");
    setAnnouncement(`Mensagem demonstrativa adicionada em ${channel.name}.`);
  }

  return (
    <main
      aria-labelledby="active-channel-title"
      className="community-grid flex h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-respawn-base"
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
            <span className="hidden text-[10px] font-bold uppercase tracking-digital text-respawn-neon sm:inline">
              mock
            </span>
          </div>
          <p className="truncate text-[11px] text-slate-400 sm:text-xs">{channel.topic}</p>
        </div>

        <div className="hidden items-center gap-3 text-slate-400 lg:flex" aria-hidden="true">
          <Bell className="h-[18px] w-[18px]" />
          <Pin className="h-[18px] w-[18px]" />
          <span className="h-5 w-px bg-white/10" />
          <span className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-respawn-neon" /> 7 online
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-5">
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
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-respawn-purple/20 bg-respawn-purple/[0.07] px-3 py-2 text-xs text-purple-200">
              <Volume2 className="h-4 w-4" /> Voz real será conectada na Fase 3.
            </div>
          ) : null}
        </section>

        <div className="flex items-center gap-3 px-4 pb-3 sm:px-6" aria-hidden="true">
          <span className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-[10px] font-bold uppercase tracking-digital text-slate-400">
            Hoje
          </span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>

        <section aria-label={`Mensagens demonstrativas de ${channel.name}`}>
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </section>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
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
            <label htmlFor="mock-message" className="sr-only">
              Mensagem demonstrativa para {channel.name}
            </label>
            <input
              id="mock-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
              maxLength={500}
              aria-describedby="composer-note"
              placeholder={`Conversar em ${channel.kind === "text" ? `#${channel.name}` : channel.name}`}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-sm text-respawn-ice outline-none placeholder:text-slate-400"
            />
            <Smile className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Adicionar mensagem demonstrativa"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-respawn-neon text-respawn-base shadow-neon-soft outline-none transition-all hover:-translate-y-0.5 hover:bg-[#68FFA2] focus-visible:ring-2 focus-visible:ring-respawn-ice disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 px-2 pb-0.5 pt-1">
            <p id="composer-note" className="flex min-w-0 items-center gap-1.5 truncate text-[10px] text-slate-400">
              <MessageSquareText className="h-3 w-3 shrink-0 text-respawn-purple" aria-hidden="true" />
              Simulação local — nenhuma mensagem é enviada à API.
            </p>
            <span className="hidden text-[10px] text-slate-400 sm:inline">
              {draft.length}/500
            </span>
          </div>
        </form>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </main>
  );
}
