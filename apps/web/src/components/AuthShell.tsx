import type { ReactNode } from "react";
import { Gamepad2, MessagesSquare, UsersRound } from "lucide-react";

import brandBackdropUrl from "../../../../branding1.png";
import { BrandMark } from "./BrandMark.js";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="min-h-full overflow-x-hidden bg-respawn-base text-respawn-ice lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
      <section
        className="relative hidden min-h-full overflow-hidden border-r border-white/10 lg:block"
        aria-label="Conheça a comunidade Respawn"
      >
        <picture className="absolute inset-0" aria-hidden="true">
          <source media="(min-width: 1024px)" srcSet={brandBackdropUrl} />
          <img
            src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
            alt=""
            className="h-full w-full object-cover object-center"
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-respawn-base/25 via-respawn-base/20 to-respawn-base/95" />
        <div className="absolute inset-0 bg-gradient-to-r from-respawn-base/15 to-respawn-base/55" />

        <div className="relative z-10 flex h-full min-h-full flex-col justify-between p-10 xl:p-14">
          <BrandMark />

          <div className="max-w-2xl rounded-[2rem] border border-white/10 bg-respawn-base/75 p-7 shadow-panel backdrop-blur-xl xl:p-9">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-digital text-respawn-neon">
              <span className="h-2 w-2 animate-pulse rounded-full bg-respawn-neon shadow-neon-soft" />
              Seu ponto de respawn
            </p>
            <h2 className="max-w-xl font-display text-3xl leading-tight tracking-tight text-respawn-ice xl:text-5xl">
              Volte pro jogo,
              <span className="block text-respawn-neon">fique pela comunidade.</span>
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 xl:text-base">
              Um espaço acolhedor para conversar, montar squad e criar conexões
              que continuam depois da partida.
            </p>

            <div className="mt-7 grid grid-cols-3 gap-3 border-t border-white/10 pt-6 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-2">
                <UsersRound className="h-4 w-4 text-respawn-neon" /> Amizades
              </span>
              <span className="flex items-center gap-2">
                <Gamepad2 className="h-4 w-4 text-respawn-purple" /> Squads
              </span>
              <span className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-respawn-neon" /> Conversas
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="auth-grid relative flex min-h-full flex-col items-center justify-center px-4 py-5 sm:px-8 sm:py-10 lg:px-10 xl:px-16">
        <div className="pointer-events-none absolute -right-28 top-[-7rem] h-72 w-72 rounded-full bg-respawn-purple/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-[-7rem] h-80 w-80 rounded-full bg-respawn-neon/10 blur-3xl" />

        <div className="relative z-10 w-full max-w-[500px]">
          <div className="mb-7 flex items-center justify-between lg:hidden">
            <BrandMark />
            <span className="rounded-full border border-respawn-neon/20 bg-respawn-neon/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-digital text-respawn-neon">
              Online
            </span>
          </div>
          
          {children}

          <footer
            aria-label="Links institucionais"
            className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] font-medium text-slate-500"
          >
            <span>© 2026 Respawn</span>
            <span aria-hidden="true">•</span>
            <a
              href="#termos"
              className="rounded-sm outline-none transition-colors hover:text-respawn-neon focus-visible:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon"
            >
              Termos
            </a>
            <span aria-hidden="true">•</span>
            <a
              href="#privacidade"
              className="rounded-sm outline-none transition-colors hover:text-respawn-neon focus-visible:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon"
            >
              Privacidade
            </a>
            <span aria-hidden="true">•</span>
            <a
              href="#suporte"
              className="rounded-sm outline-none transition-colors hover:text-respawn-neon focus-visible:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon"
            >
              Suporte
            </a>
          </footer>
        </div>
      </section>
    </main>
  );
}
