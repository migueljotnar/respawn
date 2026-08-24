import { Compass, Plus } from "lucide-react";

import { communityServers } from "../../data/community-mocks.js";
import { BrandMark } from "../BrandMark.js";

interface ServerRailProps {
  activeServerId: string;
  onSelectServer: () => void;
  className: string;
}

const accentClasses = {
  neon: "border-respawn-neon/35 bg-respawn-neon/10 text-respawn-neon",
  purple: "border-respawn-purple/35 bg-respawn-purple/10 text-purple-200",
  ice: "border-slate-500 bg-slate-500/10 text-respawn-ice",
} as const;

export function ServerRail({
  activeServerId,
  onSelectServer,
  className,
}: ServerRailProps) {
  return (
    <nav
      aria-label="Servidores"
      className={`${className} min-h-0 w-[72px] shrink-0 flex-col items-center border-r border-white/[0.07] bg-respawn-panel py-3`}
    >
      <button
        type="button"
        onClick={onSelectServer}
        aria-label="Abrir Respawn HQ"
        className="mb-3 rounded-2xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-respawn-neon"
      >
        <BrandMark compact />
      </button>

      <div className="mb-3 h-px w-8 bg-white/10" aria-hidden="true" />

      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto px-2" role="list">
        {communityServers.map((server) => {
          const isActive = server.id === activeServerId;

          return (
            <li key={server.id} className="relative">
              {isActive ? (
                <span
                  className="absolute -left-[13px] top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-respawn-neon shadow-neon-soft"
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                onClick={server.available ? onSelectServer : undefined}
                disabled={!server.available}
                aria-current={isActive ? "page" : undefined}
                aria-label={`${server.name}${server.available ? "" : " — disponível em breve"}`}
                title={`${server.name}${server.available ? "" : " — em breve"}`}
                className={`relative grid h-11 w-11 place-items-center rounded-2xl border text-xs font-black tracking-wide outline-none transition-all focus-visible:ring-2 focus-visible:ring-respawn-neon ${
                  accentClasses[server.accent]
                } ${
                  isActive
                    ? "scale-105 shadow-neon-soft"
                    : "opacity-70 hover:-translate-y-0.5 hover:opacity-100 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                }`}
              >
                {server.shortLabel}
                {!isActive && server.unreadCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-respawn-neon px-1 text-[10px] font-black text-respawn-base">
                    {server.unreadCount}
                    <span className="sr-only"> notificações não lidas</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.07] pt-3">
        <button
          type="button"
          disabled
          aria-label="Explorar comunidades — disponível em breve"
          title="Explorar comunidades — em breve"
          className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-2xl border border-slate-500/70 bg-respawn-base/50 text-slate-400 opacity-70"
        >
          <Compass className="h-5 w-5" />
        </button>
        <button
          type="button"
          disabled
          aria-label="Adicionar servidor — disponível em breve"
          title="Adicionar servidor — em breve"
          className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-2xl border border-respawn-neon/25 bg-respawn-neon/5 text-respawn-neon opacity-70"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
}
