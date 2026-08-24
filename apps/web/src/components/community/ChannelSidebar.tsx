import {
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Mic,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import type { MouseEvent } from "react";

import {
  communityChannels,
  type ChannelId,
} from "../../data/community-mocks.js";
import { communityPath } from "../../lib/app-router.js";
import type { PublicUser } from "../../lib/auth-api.js";

interface ChannelSidebarProps {
  activeChannelId: ChannelId;
  serverId: string;
  user: PublicUser;
  onNavigate: (channelId: ChannelId) => void;
  onLogout: () => void;
  className: string;
}

const sections = ["PONTO DE ENCONTRO", "ARCADE", "SALAS DE VOZ"] as const;

function getInitials(user: PublicUser): string {
  const source = user.displayName ?? user.username;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ChannelSidebar({
  activeChannelId,
  serverId,
  user,
  onNavigate,
  onLogout,
  className,
}: ChannelSidebarProps) {
  function handleChannelClick(
    event: MouseEvent<HTMLAnchorElement>,
    channelId: ChannelId,
  ) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onNavigate(channelId);
  }

  return (
    <aside
      aria-label="Navegação de canais"
      className={`${className} min-h-0 w-full min-w-0 flex-col border-r border-white/[0.07] bg-respawn-panel`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate font-bold text-respawn-ice">Respawn HQ</h2>
            <ShieldCheck className="h-4 w-4 shrink-0 text-respawn-neon" aria-label="Comunidade verificada" />
          </div>
          <p className="mt-0.5 text-[11px] uppercase tracking-digital text-slate-400">
            comunidade oficial
          </p>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>

      <div className="mx-3 mt-3 flex shrink-0 items-center justify-between rounded-xl border border-respawn-neon/15 bg-respawn-neon/[0.05] px-3 py-2.5">
        <div>
          <p className="text-xs font-bold text-respawn-ice">Comunidade em movimento</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Dados demonstrativos</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-respawn-neon px-2 py-1 text-[10px] font-black uppercase tracking-wider text-respawn-base">
          <span className="h-1.5 w-1.5 rounded-full bg-respawn-base" aria-hidden="true" />
          7 online
        </span>
      </div>

      <nav aria-label="Canais da Respawn HQ" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3">
        {sections.map((section) => {
          const channels = communityChannels.filter(
            (channel) => channel.section === section,
          );

          return (
            <section key={section} aria-labelledby={`section-${section.replaceAll(" ", "-").toLowerCase()}`} className="mb-4">
              <h3
                id={`section-${section.replaceAll(" ", "-").toLowerCase()}`}
                className="mb-1 flex items-center gap-1 px-2 text-[10px] font-extrabold uppercase tracking-digital text-slate-400"
              >
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                {section}
              </h3>
              <ul className="space-y-0.5" role="list">
                {channels.map((channel) => {
                  const isActive = channel.id === activeChannelId;
                  const ChannelIcon = channel.kind === "voice" ? Volume2 : Hash;

                  return (
                    <li key={channel.id}>
                      <a
                        href={communityPath(channel.id, serverId)}
                        onClick={(event) => handleChannelClick(event, channel.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`group relative flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
                          isActive
                            ? "bg-white/[0.07] font-semibold text-respawn-ice"
                            : "text-slate-300 hover:bg-white/[0.04] hover:text-respawn-ice"
                        }`}
                      >
                        {isActive ? (
                          <span
                            className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-respawn-neon"
                            aria-hidden="true"
                          />
                        ) : null}
                        <ChannelIcon
                          className={`h-[18px] w-[18px] shrink-0 ${
                            isActive ? "text-respawn-neon" : "text-slate-400 group-hover:text-slate-300"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                        {!isActive && channel.unreadCount > 0 ? (
                          <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-respawn-neon px-1 text-[10px] font-black text-respawn-base">
                            {channel.unreadCount}
                            <span className="sr-only"> mensagens não lidas</span>
                          </span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>

      <div className="flex min-h-[68px] shrink-0 items-center gap-2 border-t border-white/[0.07] bg-respawn-base/35 px-3 py-2">
        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-respawn-neon/25 to-respawn-purple/30 text-xs font-black text-respawn-ice">
          {getInitials(user)}
          <span
            role="img"
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-respawn-panel bg-respawn-neon"
            aria-label="Online — simulação visual"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-respawn-ice">
            {user.displayName ?? user.username}
          </p>
          <p className="truncate text-[10px] text-slate-400">@{user.username}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled
            aria-label="Microfone — disponível na fase de voz"
            className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-lg text-slate-500 opacity-70"
          >
            <Mic className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Áudio — disponível na fase de voz"
            className="hidden h-9 w-9 cursor-not-allowed place-items-center rounded-lg text-slate-500 opacity-70 min-[900px]:grid"
          >
            <Headphones className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sair desta sessão"
            title="Sair desta sessão"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-white/[0.06] hover:text-red-300 focus-visible:ring-2 focus-visible:ring-respawn-neon"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
