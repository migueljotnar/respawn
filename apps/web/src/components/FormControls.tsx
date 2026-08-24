import { useState, type ChangeEventHandler, type HTMLInputTypeAttribute } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete: string;
  placeholder: string;
  error: string | undefined;
  type?: HTMLInputTypeAttribute;
  helper?: string;
  inputMode?: "email" | "text";
  maxLength?: number;
}

const inputClassName =
  "min-h-12 w-full rounded-xl border bg-respawn-base/80 px-4 py-3 text-[15px] text-respawn-ice outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-respawn-neon/70 focus:ring-2 focus:ring-respawn-neon/20 disabled:cursor-not-allowed disabled:opacity-60";

export function TextField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  type = "text",
  helper,
  inputMode,
  maxLength,
}: TextFieldProps) {
  const helperId = helper ? `${id}-helper` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-200">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`${inputClassName} ${
          error ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/20" : "border-slate-500"
        }`}
      />
      {helper ? (
        <p id={helperId ?? undefined} className="mt-1.5 text-xs leading-5 text-slate-400">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId ?? undefined} className="mt-1.5 text-xs font-medium text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete: "current-password" | "new-password";
  placeholder: string;
  error: string | undefined;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-200">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={`${inputClassName} pr-14 ${
            error ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/20" : "border-slate-500"
          }`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          className="absolute inset-y-0 right-1 grid min-w-11 place-items-center rounded-lg text-slate-400 outline-none transition hover:text-respawn-ice focus-visible:ring-2 focus-visible:ring-respawn-neon/70"
          aria-label={isVisible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={isVisible}
        >
          {isVisible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SubmitButtonProps {
  idleLabel: string;
  pendingLabel: string;
  isPending: boolean;
}

export function SubmitButton({
  idleLabel,
  pendingLabel,
  isPending,
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="group relative flex min-h-12 w-full items-center justify-center overflow-hidden rounded-xl bg-respawn-neon px-5 py-3.5 text-sm font-extrabold uppercase tracking-wider text-respawn-base shadow-neon-soft outline-none transition hover:-translate-y-0.5 hover:bg-[#68FFA2] hover:shadow-[0_0_42px_rgba(57,255,136,0.28)] focus-visible:ring-2 focus-visible:ring-respawn-ice focus-visible:ring-offset-2 focus-visible:ring-offset-respawn-panel disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="relative z-10 flex items-center gap-2">
        {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {isPending ? pendingLabel : idleLabel}
      </span>
    </button>
  );
}
