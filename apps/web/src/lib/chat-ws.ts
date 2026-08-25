import { io as createSocket, type Socket } from "socket.io-client";

import type { MemberRole } from "../data/community-mocks.js";

export interface ChatAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export interface ChatMessageDto {
  id: string;
  channelSlug: string;
  content: string;
  createdAt: string;
  author: ChatAuthor;
}

export interface TypingUpdate {
  channelSlug: string;
  userId: string;
  username: string;
  typing: boolean;
}

export interface PresenceUpdate {
  userId: string;
  online: boolean;
}

export interface ConnectionAck {
  userId: string;
  onlineUserIds: string[];
}

type ChatAck = (response: { ok: true } | { error: string }) => void;

interface ServerToClientEvents {
  "connection:ack": (payload: ConnectionAck) => void;
  "message:new": (payload: ChatMessageDto) => void;
  "typing:update": (payload: TypingUpdate) => void;
  "presence:update": (payload: PresenceUpdate) => void;
}

interface ClientToServerEvents {
  "channel:join": (payload: { channelSlug: string }, ack: ChatAck) => void;
  "message:send": (
    payload: { channelSlug: string; content: string; clientMessageId?: string },
    ack: ChatAck,
  ) => void;
  "typing:start": (payload: { channelSlug: string }) => void;
  "typing:stop": (payload: { channelSlug: string }) => void;
}

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const apiBaseUrl = configuredApiUrl.replace(/\/+$/, "");

export function connectChatSocket(token: string): ChatSocket {
  return apiBaseUrl
    ? createSocket(apiBaseUrl, { auth: { token } })
    : createSocket({ auth: { token } });
}

const ACK_TIMEOUT_MS = 8_000;

export function joinChannel(socket: ChatSocket, channelSlug: string): Promise<void> {
  if (!socket.connected) {
    return Promise.reject(new ChatSendError("offline", "not_connected"));
  }

  return new Promise((resolve, reject) => {
    socket.timeout(ACK_TIMEOUT_MS).emit("channel:join", { channelSlug }, (timeoutError, ack) => {
      if (timeoutError) {
        reject(new ChatSendError("timeout", "join_ack_timeout"));
        return;
      }

      if (!ack) {
        reject(new ChatSendError("rejected", "invalid_ack"));
        return;
      }

      if ("error" in ack) {
        reject(new ChatSendError("rejected", ack.error));
        return;
      }

      resolve();
    });
  });
}

/**
 * "rejected": o servidor respondeu com um erro explícito — falha definitiva,
 * o conteúdo não foi persistido, é seguro deixar o usuário tentar de novo.
 * "offline": nem tentamos emitir porque o socket já estava desconectado —
 * por design do Socket.IO, emitir nesse estado apenas enfileira o pacote
 * para ser disparado sozinho no próximo reconnect, o que persistiria uma
 * mensagem depois de já termos avisado "falha" ao usuário. Tratamos como
 * definitiva também: nada foi (nem será) enviado.
 * "timeout": o ACK nunca chegou — resultado indeterminado, a mensagem pode
 * ou não ter sido persistida no servidor antes da conexão cair. Não é
 * seguro reenviar automaticamente com o mesmo texto; se chegar de verdade,
 * ela aparece via message:new normalmente (a store deduplica por id).
 */
export type ChatSendOutcome = "rejected" | "offline" | "timeout";

export class ChatSendError extends Error {
  readonly outcome: ChatSendOutcome;
  readonly code: string;

  constructor(outcome: ChatSendOutcome, code: string) {
    super(code);
    this.name = "ChatSendError";
    this.outcome = outcome;
    this.code = code;
  }
}

export function sendChatMessage(
  socket: ChatSocket,
  channelSlug: string,
  content: string,
  clientMessageId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Emitir enquanto desconectado não falha na hora — o Socket.IO client
    // enfileira o pacote e dispara ele sozinho no próximo reconnect. Isso é
    // exatamente o bug reproduzido: a UI já mostrou "falha" e, minutos
    // depois, a mensagem aparece do nada quando a API volta. Verificar
    // `connected` antes de emitir garante que nada fica pendurado no buffer.
    if (!socket.connected) {
      reject(new ChatSendError("offline", "not_connected"));
      return;
    }

    // O timeout precisa pertencer ao Socket.IO, não a um timer paralelo da
    // UI. Além de rejeitar o ACK, `socket.timeout()` remove do `sendBuffer` o
    // pacote que ficou preso durante uma queda ocorrida entre o precheck
    // acima e o emit. Assim ele não reaparece sozinho no próximo reconnect.
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit("message:send", { channelSlug, content, clientMessageId }, (timeoutError, ack) => {
        if (timeoutError) {
          reject(new ChatSendError("timeout", "ack_timeout"));
          return;
        }

        if (!ack) {
          reject(new ChatSendError("rejected", "invalid_ack"));
          return;
        }

        if ("error" in ack) {
          reject(new ChatSendError("rejected", ack.error));
          return;
        }

        resolve();
      });
  });
}

export function startTyping(socket: ChatSocket, channelSlug: string): void {
  if (!socket.connected) {
    return;
  }

  // Typing e estado efemero: nunca deve reaparecer depois de uma reconexao.
  // O emit volatil descarta o pacote quando o transporte deixou de estar
  // gravavel entre o precheck acima e a decisao interna do Socket.IO.
  socket.volatile.emit("typing:start", { channelSlug });
}

export function stopTyping(socket: ChatSocket, channelSlug: string): void {
  if (!socket.connected) {
    return;
  }

  socket.volatile.emit("typing:stop", { channelSlug });
}
