import type { MemberRole } from "../data/community-mocks.js";
import { readSessionToken } from "./session-storage.js";
import type { ChatMessageDto } from "./chat-ws.js";

export interface ChatMemberDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
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

function isChatAuthor(value: unknown): value is ChatMessageDto["author"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.username === "string" &&
    isNullableString(value.displayName) &&
    isNullableString(value.avatarUrl) &&
    typeof value.role === "string"
  );
}

function isChatMessage(value: unknown): value is ChatMessageDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.channelSlug === "string" &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    isChatAuthor(value.author)
  );
}

function isChatMember(value: unknown): value is ChatMemberDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.username === "string" &&
    isNullableString(value.displayName) &&
    isNullableString(value.avatarUrl) &&
    typeof value.role === "string"
  );
}

async function chatRequest(path: string): Promise<unknown> {
  const token = readSessionToken();
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ChatApiError(
      0,
      "NETWORK_ERROR",
      "Não foi possível alcançar o servidor. Confira sua conexão e tente novamente.",
    );
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null;
    throw new ChatApiError(
      response.status,
      typeof errorBody?.code === "string" ? errorBody.code : "REQUEST_FAILED",
      typeof errorBody?.message === "string"
        ? errorBody.message
        : "Não foi possível concluir a solicitação.",
    );
  }

  if (!isRecord(body) || !("data" in body)) {
    throw new ChatApiError(
      response.status,
      "INVALID_RESPONSE",
      "O servidor retornou uma resposta inesperada.",
    );
  }

  return body.data;
}

export const chatApi = {
  async listMessages(
    channelSlug: string,
    options?: {
      limit?: number;
      beforeCreatedAt?: string;
      beforeId?: string;
      afterCreatedAt?: string;
      afterId?: string;
    },
  ): Promise<ChatMessageDto[]> {
    const params = new URLSearchParams();

    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.beforeCreatedAt) params.set("beforeCreatedAt", options.beforeCreatedAt);
    if (options?.beforeId) params.set("beforeId", options.beforeId);
    if (options?.afterCreatedAt) params.set("afterCreatedAt", options.afterCreatedAt);
    if (options?.afterId) params.set("afterId", options.afterId);

    const query = params.toString();
    const data = await chatRequest(
      `/api/chat/channels/${encodeURIComponent(channelSlug)}/messages${query ? `?${query}` : ""}`,
    );

    return Array.isArray(data) ? data.filter(isChatMessage) : [];
  },

  async listMembers(): Promise<ChatMemberDto[]> {
    const data = await chatRequest("/api/chat/members");
    return Array.isArray(data) ? data.filter(isChatMember) : [];
  },
};
