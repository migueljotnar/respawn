export type FormErrors<T extends string> = Partial<Record<T, string>>;

const simpleEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[A-Za-z0-9_.-]+$/;

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

export function validateEmail(email: string): string | undefined {
  if (!email) {
    return "Informe seu email.";
  }

  if (email.length > 320 || !simpleEmailPattern.test(email)) {
    return "Digite um email válido.";
  }

  return undefined;
}

export function validateLoginPassword(password: string): string | undefined {
  if (!password) {
    return "Informe sua senha.";
  }

  if (passwordByteLength(password) > 72) {
    return "A senha deve ter no máximo 72 bytes.";
  }

  return undefined;
}

export function validateUsername(username: string): string | undefined {
  if (username.length < 3 || username.length > 32) {
    return "Use entre 3 e 32 caracteres.";
  }

  if (!usernamePattern.test(username)) {
    return "Use apenas letras, números, ponto, hífen ou sublinhado.";
  }

  return undefined;
}

export function validateDisplayName(displayName: string): string | undefined {
  if (displayName.length > 64) {
    return "Use no máximo 64 caracteres.";
  }

  return undefined;
}

export function validateRegistrationPassword(
  password: string,
): string | undefined {
  if (password.length < 12) {
    return "Use pelo menos 12 caracteres.";
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Inclua letra maiúscula, minúscula e número.";
  }

  if (passwordByteLength(password) > 72) {
    return "A senha deve ter no máximo 72 bytes.";
  }

  return undefined;
}
