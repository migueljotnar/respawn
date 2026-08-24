import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ShieldCheck } from "lucide-react";

import { AuthCard } from "../components/AuthCard.js";
import { PasswordField, SubmitButton, TextField } from "../components/FormControls.js";
import { StatusBanner } from "../components/StatusBanner.js";
import {
  ApiClientError,
  authApi,
  type AuthResult,
} from "../lib/auth-api.js";
import {
  validateEmail,
  validateLoginPassword,
  type FormErrors,
} from "../lib/form-validation.js";

type LoginField = "email" | "password";

interface LoginPageProps {
  onAuthenticated: (result: AuthResult) => Promise<void>;
  onNavigate: (path: "/login" | "/register") => void;
  notice: string | null;
}

export function LoginPage({ onAuthenticated, onNavigate, notice }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors<LoginField>>({});
  const [formError, setFormError] = useState<string | null>(notice);
  const [isPending, setIsPending] = useState(false);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPending) {
      return;
    }

    const normalizedEmail = email.trim();
    const nextErrors: FormErrors<LoginField> = {};
    const emailError = validateEmail(normalizedEmail);
    const passwordError = validateLoginPassword(password);

    if (emailError) nextErrors.email = emailError;
    if (passwordError) nextErrors.password = passwordError;

    setFieldErrors(nextErrors);
    setFormError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsPending(true);
    requestController.current = new AbortController();

    try {
      const result = await authApi.login(
        { email: normalizedEmail, password },
        requestController.current.signal,
      );
      await onAuthenticated(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (error instanceof ApiClientError) {
        setFieldErrors({
          ...(error.fields?.email?.[0] ? { email: error.fields.email[0] } : {}),
          ...(error.fields?.password?.[0]
            ? { password: error.fields.password[0] }
            : {}),
        });
        setFormError(error.message);
      } else {
        setFormError("Não foi possível entrar agora. Tente novamente.");
      }
    } finally {
      setIsPending(false);
      requestController.current = null;
    }
  }

  function handleRegisterLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onNavigate("/register");
  }

  return (
    <AuthCard
      eyebrow="Canal seguro // Login"
      title="Bom ter você de volta."
      description="Entre para reencontrar seu squad e continuar de onde parou."
    >
      <StatusBanner message={formError} />

      <form noValidate onSubmit={handleSubmit} aria-busy={isPending} className="space-y-5">
        <TextField
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="voce@exemplo.com"
          maxLength={320}
          error={fieldErrors.email}
        />

        <PasswordField
          id="password"
          label="Senha"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="Digite sua senha"
          error={fieldErrors.password}
        />

        <SubmitButton
          idleLabel="Entrar na Respawn"
          pendingLabel="Conectando..."
          isPending={isPending}
        />
      </form>

      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-white/5 bg-respawn-base/45 p-3 text-xs leading-5 text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-respawn-neon" aria-hidden="true" />
        A Respawn não salva sua senha neste dispositivo.
      </div>

      <p className="mt-6 text-center text-sm text-slate-400">
        Ainda não faz parte?{" "}
        <a
          href="/register"
          onClick={handleRegisterLink}
          className="font-bold text-respawn-neon underline-offset-4 outline-none transition hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-respawn-neon"
        >
          Crie seu ponto de respawn
        </a>
      </p>
    </AuthCard>
  );
}
