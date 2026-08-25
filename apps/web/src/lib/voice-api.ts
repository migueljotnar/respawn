import { readSessionToken } from "./session-storage.js";

export interface VoiceTokenDto {
  token: string;
  url: string;
  roomName: string;
}

export class VoiceApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VoiceApiError";
    this.status = status;
    this.code = code;
  }
}

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const apiBaseUrl = configuredApiUrl.replace(/\/+$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVoiceToken(value: unknown): value is VoiceTokenDto {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.url === "string" &&
    typeof value.roomName === "string"
  );
}

export const voiceApi = {
  async fetchToken(channelSlug: string, signal?: AbortSignal): Promise<VoiceTokenDto> {
    const sessionToken = readSessionToken();
    let response: Response;

    try {
      response = await fetch(`${apiBaseUrl}/api/voice/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ channelSlug }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      throw new VoiceApiError(
        0,
        "NETWORK_ERROR",
        "Não foi possível alcançar o servidor. Confira sua conexão e tente novamente.",
      );
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null;
      throw new VoiceApiError(
        response.status,
        typeof errorBody?.code === "string" ? errorBody.code : "REQUEST_FAILED",
        typeof errorBody?.message === "string"
          ? errorBody.message
          : "Não foi possível concluir a solicitação.",
      );
    }

    if (!isRecord(body) || !isVoiceToken(body.data)) {
      throw new VoiceApiError(
        response.status,
        "INVALID_RESPONSE",
        "O servidor retornou uma resposta inesperada.",
      );
    }

    return body.data;
  },
};
