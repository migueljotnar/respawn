const TOKEN_KEY = "respawn.auth.token.v1";
let inMemoryToken: string | null = null;
let isMemoryInitialized = false;

function readPersistedToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function readSessionToken(): string | null {
  if (!isMemoryInitialized) {
    inMemoryToken = readPersistedToken();
    isMemoryInitialized = true;
  }

  return inMemoryToken;
}

export function storeSessionToken(token: string): void {
  inMemoryToken = token;
  isMemoryInitialized = true;

  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A sessão continua em memória quando o navegador bloqueia o armazenamento.
  }
}

export function clearSessionToken(): void {
  inMemoryToken = null;
  isMemoryInitialized = true;

  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Não há persistência a remover quando o armazenamento está indisponível.
  }
}

export function clearSessionTokenIfMatches(token: string): void {
  if (readSessionToken() === token) {
    clearSessionToken();
  }
}
