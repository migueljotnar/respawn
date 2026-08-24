import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Check, Circle } from "lucide-react";

import { AuthCard } from "../components/AuthCard.js";
import { PasswordField, SubmitButton, TextField } from "../components/FormControls.js";
import { StatusBanner } from "../components/StatusBanner.js";
import {
  ApiClientError,
  authApi,
  type AuthResult,
  type RegisterPayload,
} from "../lib/auth-api.js";
import {
  passwordByteLength,
  validateDisplayName,
  validateEmail,
  validateRegistrationPassword,
  validateUsername,
  type FormErrors,
} from "../lib/form-validation.js";

type RegisterField =
  | "email"
  | "username"
  | "displayName"
  | "password"
  | "confirmPassword";

interface RegisterPageProps {
  onAuthenticated: (result: AuthResult) => Promise<void>;
  onNavigate: (path: "/login" | "/register") => void;
}

export function RegisterPage({ onAuthenticated, onNavigate }: RegisterPageProps) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors<RegisterField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  const passwordChecks = [
    { label: "12+ caracteres", passed: password.length >= 12 },
    { label: "Maiúscula e minúscula", passed: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: "Pelo menos um número", passed: /[0-9]/.test(password) },
    {
      label: "Até 72 bytes",
      passed: password.length > 0 && passwordByteLength(password) <= 72,
    },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPending) {
      return;
    }

    const normalizedEmail = email.trim();
    const normalizedUsername = username.trim();
    const normalizedDisplayName = displayName.trim();
    const nextErrors: FormErrors<RegisterField> = {};
    const emailError = validateEmail(normalizedEmail);
    const usernameError = validateUsername(normalizedUsername);
    const displayNameError = validateDisplayName(normalizedDisplayName);
    const passwordError = validateRegistrationPassword(password);

    if (emailError) nextErrors.email = emailError;
    if (usernameError) nextErrors.username = usernameError;
    if (displayNameError) nextErrors.displayName = displayNameError;
    if (passwordError) nextErrors.password = passwordError;
    if (password !== confirmPassword) {
      nextErrors.confirmPassword = "As senhas não coincidem.";
    }

    setFieldErrors(nextErrors);
    setFormError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload: RegisterPayload = {
      email: normalizedEmail,
      username: normalizedUsername,
      password,
      ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
    };

    setIsPending(true);
    requestController.current = new AbortController();

    try {
      const result = await authApi.register(payload, requestController.current.signal);
      await onAuthenticated(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (error instanceof ApiClientError) {
        setFieldErrors({
          ...(error.fields?.email?.[0] ? { email: error.fields.email[0] } : {}),
          ...(error.fields?.username?.[0]
            ? { username: error.fields.username[0] }
            : {}),
          ...(error.fields?.displayName?.[0]
            ? { displayName: error.fields.displayName[0] }
            : {}),
          ...(error.fields?.password?.[0]
            ? { password: error.fields.password[0] }
            : {}),
        });
        setFormError(error.message);
      } else {
        setFormError("Não foi possível criar sua conta agora. Tente novamente.");
      }
    } finally {
      setIsPending(false);
      requestController.current = null;
    }
  }

  function handleLoginLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onNavigate("/login");
  }

  return (
    <AuthCard
      eyebrow="Novo jogador // Cadastro"
      title="Crie seu ponto de respawn."
      description="Monte seu perfil e encontre gente boa para jogar, conversar e pertencer."
    >
      <StatusBanner message={formError} />

      <form noValidate onSubmit={handleSubmit} aria-busy={isPending} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="displayName"
            label="Como quer ser chamado?"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            placeholder="Seu nome"
            maxLength={64}
            helper="Opcional"
            error={fieldErrors.displayName}
          />
          <TextField
            id="username"
            label="Nome de usuário"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="player_one"
            maxLength={32}
            error={fieldErrors.username}
          />
        </div>

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
          autoComplete="new-password"
          placeholder="Crie uma senha forte"
          error={fieldErrors.password}
        />

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-white/5 bg-respawn-base/45 p-3" aria-live="polite">
          {passwordChecks.map((check) => (
            <span
              key={check.label}
              className={`flex items-center gap-1.5 text-[11px] ${
                check.passed ? "text-respawn-neon" : "text-slate-400"
              }`}
            >
              {check.passed ? (
                <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
              ) : (
                <Circle className="h-3 w-3 shrink-0" />
              )}
              <span className="sr-only">
                {check.passed ? "Requisito atendido:" : "Requisito pendente:"}
              </span>
              {check.label}
            </span>
          ))}
        </div>

        <PasswordField
          id="confirmPassword"
          label="Confirme sua senha"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="Digite a senha novamente"
          error={fieldErrors.confirmPassword}
        />

        <SubmitButton
          idleLabel="Criar minha conta"
          pendingLabel="Criando seu perfil..."
          isPending={isPending}
        />
      </form>

      <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
        Ao continuar, você concorda em manter a Respawn respeitosa, segura e acolhedora.
      </p>

      <p className="mt-5 text-center text-sm text-slate-400">
        Já tem uma conta?{" "}
        <a
          href="/login"
          onClick={handleLoginLink}
          className="font-bold text-respawn-neon underline-offset-4 outline-none transition hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-respawn-neon"
        >
          Voltar para o login
        </a>
      </p>
    </AuthCard>
  );
}
