import { useState } from "react";
import {
  CheckCircle2,
  Gamepad2,
  LoaderCircle,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

import type { VerifiedSession } from "../lib/auth-api.js";
import { AuthCard } from "./AuthCard.js";

interface SessionLoadingProps {
  message: string;
}

export function SessionLoading({ message }: SessionLoadingProps) {
  return (
    <AuthCard
      eyebrow="Handshake seguro"
      title="Validando sua sessão..."
      description="Só um instante enquanto sincronizamos seu ponto de respawn."
    >
      <div className="flex items-center gap-4 rounded-2xl border border-respawn-neon/15 bg-respawn-neon/5 p-5 text-sm text-slate-300" role="status">
        <LoaderCircle className="h-6 w-6 shrink-0 animate-spin text-respawn-neon" />
        {message}
      </div>
    </AuthCard>
  );
}

interface SessionReadyProps {
  data: VerifiedSession;
  onVerify: () => Promise<void>;
  onLogout: () => void;
}

export function SessionReady({ data, onVerify, onLogout }: SessionReadyProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const displayName = data.user.displayName ?? data.user.username;
  const expiresAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.session.expiresAt));

  async function handleVerify() {
    if (isVerifying) return;
    setIsVerifying(true);

    try {
      await onVerify();
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <AuthCard
      eyebrow="Autenticação concluída"
      title={`GG, ${displayName}!`}
      description="Sua sessão está ativa. O próximo checkpoint liberará o layout principal da comunidade."
    >
      <div className="rounded-2xl border border-respawn-neon/20 bg-respawn-neon/[0.06] p-5 shadow-neon-soft" role="status">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-respawn-neon/10 text-respawn-neon">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="font-bold text-respawn-ice">Conexão estabelecida</p>
            <p className="mt-0.5 text-xs text-slate-400">@{data.user.username}</p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 border-t border-white/10 pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-400">Email</dt>
            <dd className="mt-1 truncate text-slate-200" title={data.user.email}>
              {data.user.email}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-400">Sessão válida até</dt>
            <dd className="mt-1 text-slate-200">{expiresAt}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={isVerifying}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-respawn-neon px-4 text-sm font-extrabold uppercase tracking-wider text-respawn-base outline-none transition hover:bg-[#68FFA2] focus-visible:ring-2 focus-visible:ring-respawn-ice disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerifying ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {isVerifying ? "Verificando..." : "Verificar sessão"}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-500 bg-respawn-base/60 px-4 text-sm font-bold text-slate-300 outline-none transition hover:border-slate-400 hover:text-respawn-ice focus-visible:ring-2 focus-visible:ring-respawn-neon"
        >
          <LogOut className="h-4 w-4" />
          Sair neste dispositivo
        </button>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-slate-400">
        <Gamepad2 className="h-4 w-4 text-respawn-purple" aria-hidden="true" />
        Nenhum token ou senha é exibido nesta tela.
      </p>
    </AuthCard>
  );
}

interface SessionUnavailableProps {
  message: string;
  onRetry: () => void;
  onLogout: () => void;
}

export function SessionUnavailable({
  message,
  onRetry,
  onLogout,
}: SessionUnavailableProps) {
  return (
    <AuthCard
      eyebrow="Sinal interrompido"
      title="Não conseguimos sincronizar."
      description="Seu acesso foi preservado neste dispositivo. Tente novamente quando a API estiver disponível."
    >
      <div className="flex gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm leading-6 text-amber-100" role="alert">
        <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        {message}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onRetry}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-respawn-neon px-4 text-sm font-extrabold uppercase tracking-wider text-respawn-base outline-none transition hover:bg-[#68FFA2] focus-visible:ring-2 focus-visible:ring-respawn-ice"
        >
          <RefreshCcw className="h-4 w-4" />
          Tentar novamente
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="min-h-12 rounded-xl border border-slate-500 bg-respawn-base/60 px-4 text-sm font-bold text-slate-300 outline-none transition hover:border-slate-400 hover:text-respawn-ice focus-visible:ring-2 focus-visible:ring-respawn-neon"
        >
          Usar outra conta
        </button>
      </div>
    </AuthCard>
  );
}
