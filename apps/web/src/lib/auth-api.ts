export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  expiresAt: string;
}

export interface AuthResult {
  user: PublicUser;
  session: SessionInfo;
  token: string;
  tokenType: "Bearer";
}

export interface VerifiedSession {
  user: PublicUser;
  session: SessionInfo;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export type ApiFieldErrors = Record<string, string[]>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ApiFieldErrors | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: ApiFieldErrors,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const apiBaseUrl = configuredApiUrl.replace(/\/+$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPublicUser(value: unknown): value is PublicUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.username === "string" &&
    isNullableString(value.displayName) &&
    isNullableString(value.avatarUrl) &&
    typeof value.createdAt === "string"
  );
}

function isSessionInfo(value: unknown): value is SessionInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function isAuthResult(value: unknown): value is AuthResult {
  return (
    isRecord(value) &&
    isPublicUser(value.user) &&
    isSessionInfo(value.session) &&
    typeof value.token === "string" &&
    value.token.split(".").length === 3 &&
    value.tokenType === "Bearer"
  );
}

function isVerifiedSession(value: unknown): value is VerifiedSession {
  return (
    isRecord(value) &&
    isPublicUser(value.user) &&
    isSessionInfo(value.session)
  );
}

function invalidResponse(status: number): ApiClientError {
  return new ApiClientError(
    status,
    "INVALID_RESPONSE",
    "O servidor retornou uma resposta inesperada.",
  );
}

function readFieldErrors(value: unknown): ApiFieldErrors | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string"),
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return null;
  }
}

interface ResponseData {
  data: unknown;
  status: number;
}

async function request(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<ResponseData> {
  let response: Response;
  let body: unknown;
  const requestController = new AbortController();
  const timeoutId = window.setTimeout(() => requestController.abort(), 15_000);
  const handleExternalAbort = () => requestController.abort();

  if (signal?.aborted) {
    requestController.abort();
  } else {
    signal?.addEventListener("abort", handleExternalAbort, { once: true });
  }

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
      signal: requestController.signal,
    });
    body = await readResponseBody(response);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    if (requestController.signal.aborted) {
      throw new ApiClientError(
        0,
        "REQUEST_TIMEOUT",
        "O servidor demorou para responder. Tente novamente.",
      );
    }

    throw new ApiClientError(
      0,
      "NETWORK_ERROR",
      "Não foi possível alcançar o servidor. Confira sua conexão e tente novamente.",
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleExternalAbort);
  }

  if (!response.ok) {
    const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null;
    const code =
      errorBody && typeof errorBody.code === "string"
        ? errorBody.code
        : "REQUEST_FAILED";
    const message =
      errorBody && typeof errorBody.message === "string"
        ? errorBody.message
        : "Não foi possível concluir a solicitação.";

    throw new ApiClientError(
      response.status,
      code,
      message,
      errorBody ? readFieldErrors(errorBody.fields) : undefined,
    );
  }

  if (response.status === 204) {
    return { data: null, status: response.status };
  }

  if (!isRecord(body) || !("data" in body)) {
    throw invalidResponse(response.status);
  }

  return { data: body.data, status: response.status };
}

export const authApi = {
  async register(payload: RegisterPayload, signal?: AbortSignal): Promise<AuthResult> {
    const response = await request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );

    if (!isAuthResult(response.data)) {
      throw invalidResponse(response.status);
    }

    return response.data;
  },

  async login(payload: LoginPayload, signal?: AbortSignal): Promise<AuthResult> {
    const response = await request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );

    if (!isAuthResult(response.data)) {
      throw invalidResponse(response.status);
    }

    return response.data;
  },

  async getSession(token: string, signal?: AbortSignal): Promise<VerifiedSession> {
    const response = await request(
      "/api/auth/session",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      signal,
    );

    if (!isVerifiedSession(response.data)) {
      throw invalidResponse(response.status);
    }

    return response.data;
  },

  async logout(token: string, signal?: AbortSignal): Promise<void> {
    await request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
      signal,
    );
  },
};
