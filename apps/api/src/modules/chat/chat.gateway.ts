import type { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";

import { Server as SocketIOServer, type Socket } from "socket.io";

import type { AuthService, PublicUser } from "../auth/auth.service.js";
import {
  beginSessionRevocation,
  cancelSessionRevocation,
  isSessionRevocationPending,
  isSessionRevoked,
  markSessionRevoked,
  SESSION_REVOKED_EVENT,
  type SessionRevokedPayload,
  withSessionLock,
} from "../auth/session-events.js";
import { ApiError } from "../../shared/api-error.js";
import {
  joinChannelSchema,
  sendMessageSchema,
  typingSchema,
} from "./chat.schemas.js";
import type { ChatService } from "./chat.service.js";

export interface ChatGatewayOptions {
  corsOrigin: string;
  authService: AuthService;
  chatService: ChatService;
  sessionEvents: EventEmitter;
}

interface SocketData {
  user: PublicUser;
  token: string;
  sessionId: string;
  expiresAt: Date;
}

type AckResponse = { ok: true } | { error: string };

/**
 * O segundo argumento de um evento Socket.IO vem direto da rede — um cliente
 * (malicioso ou com bug) pode mandar uma string/objeto/número no lugar do
 * callback. `typeof ack === "function"` é a única checagem confiável; usar
 * optional chaining sozinho (`ack?.(...)`) não bloqueia valores não-nulos que
 * não são funções e derruba o processo inteiro com um TypeError não tratado.
 */
function reply(ack: unknown, payload: AckResponse): void {
  if (typeof ack === "function") {
    (ack as (response: AckResponse) => void)(payload);
  }
}

function errorCodeFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code.toLowerCase();
  }

  return "internal_error";
}

// Timeout do Node não aceita delays maiores que ~24.8 dias (estoura o inteiro
// de 32 bits e dispara na hora). JWT_TTL_SECONDS permite até 30 dias, então
// reagendamos em blocos menores que esse teto até a expiração real chegar.
const MAX_TIMEOUT_MS = 2_147_000_000;

function extractToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;

  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }

  const authorization = socket.handshake.headers.authorization;
  const bearerMatch = authorization?.match(/^Bearer ([^\s]+)$/i);

  return bearerMatch?.[1];
}

function roomName(channelSlug: string): string {
  return `channel:${channelSlug}`;
}

class PresenceTracker {
  private readonly socketsByUser = new Map<string, Set<string>>();

  /** Retorna true se o usuário estava offline e passou a ficar online. */
  add(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);
    return wasOffline;
  }

  /** Retorna true se essa era a última conexão do usuário (ficou offline). */
  remove(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      return false;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
      return true;
    }

    return false;
  }

  onlineUserIds(): string[] {
    return [...this.socketsByUser.keys()];
  }
}

/**
 * O evento público de typing é por usuário, mas um usuário pode ter vários
 * sockets. O tracker só sinaliza transições agregadas 0→1 e 1→0, impedindo
 * que uma aba envie stop enquanto outra ainda está digitando.
 */
class TypingTracker {
  private readonly socketsByChannelAndUser = new Map<string, Map<string, Set<string>>>();

  start(channelSlug: string, userId: string, socketId: string): boolean {
    const users = this.socketsByChannelAndUser.get(channelSlug) ?? new Map();
    const sockets = users.get(userId) ?? new Set<string>();
    const wasNotTyping = sockets.size === 0;

    sockets.add(socketId);
    users.set(userId, sockets);
    this.socketsByChannelAndUser.set(channelSlug, users);
    return wasNotTyping;
  }

  stop(channelSlug: string, userId: string, socketId: string): boolean {
    const users = this.socketsByChannelAndUser.get(channelSlug);
    const sockets = users?.get(userId);

    if (!users || !sockets || !sockets.delete(socketId)) {
      return false;
    }

    if (sockets.size > 0) {
      return false;
    }

    users.delete(userId);
    if (users.size === 0) {
      this.socketsByChannelAndUser.delete(channelSlug);
    }

    return true;
  }
}

/**
 * Rastreia quais sockets pertencem a qual sessão (não usuário — um usuário
 * pode ter várias sessões, uma por aba/dispositivo logado independentemente).
 * Permite ao logout/revogação derrubar exatamente os sockets da sessão
 * revogada, sem afetar as outras abas/sessões do mesmo usuário.
 */
class SessionSocketRegistry {
  private readonly socketsBySession = new Map<string, Set<Socket>>();

  register(sessionId: string, socket: Socket): void {
    const sockets = this.socketsBySession.get(sessionId) ?? new Set<Socket>();
    sockets.add(socket);
    this.socketsBySession.set(sessionId, sockets);
  }

  unregister(sessionId: string, socket: Socket): void {
    const sockets = this.socketsBySession.get(sessionId);

    if (!sockets) {
      return;
    }

    sockets.delete(socket);

    if (sockets.size === 0) {
      this.socketsBySession.delete(sessionId);
    }
  }

  disconnectSession(sessionId: string): void {
    const sockets = this.socketsBySession.get(sessionId);

    if (!sockets) {
      return;
    }

    // disconnect dispara unregister de forma síncrona e muta o Set; iterar
    // uma cópia garante que todos os sockets originais sejam visitados.
    for (const socket of [...sockets]) {
      socket.disconnect(true);
    }
  }
}

export function attachChatGateway(
  server: HttpServer,
  options: ChatGatewayOptions,
): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: options.corsOrigin,
      methods: ["GET", "POST"],
    },
  });
  const presence = new PresenceTracker();
  const typing = new TypingTracker();
  const sessionSockets = new SessionSocketRegistry();

  function handleSessionRevoked(payload: SessionRevokedPayload): void {
    if (isSessionRevoked(options.sessionEvents, payload.sessionId)) {
      // Logout interno: auth já persistiu e marcou a tombstone sob o mesmo
      // lock, depois emitiu fora dele para não reentrar no coordenador.
      sessionSockets.disconnectSession(payload.sessionId);
      return;
    }

    // Evento externo: pending barra ações novas/enfileiradas imediatamente.
    // A operação que já possui o lock pode concluir como logicamente anterior
    // à revogação; depois o próprio evento entra na fila, marca e desconecta.
    beginSessionRevocation(options.sessionEvents, payload.sessionId);
    void withSessionLock(options.sessionEvents, payload.sessionId, async () => {
      markSessionRevoked(options.sessionEvents, payload.sessionId);
      sessionSockets.disconnectSession(payload.sessionId);
    }).catch(() => {
      cancelSessionRevocation(options.sessionEvents, payload.sessionId);
    });
  }

  options.sessionEvents.on(SESSION_REVOKED_EVENT, handleSessionRevoked);
  server.once("close", () => {
    options.sessionEvents.off(SESSION_REVOKED_EVENT, handleSessionRevoked);
  });

  io.use((socket, next) => {
    const token = extractToken(socket);

    if (!token) {
      next(new Error("unauthorized"));
      return;
    }

    options.authService
      .verifySession(token)
      .then((verified) => {
        if (!verified) {
          next(new Error("unauthorized"));
          return;
        }

        const data = socket.data as SocketData;
        data.user = verified.user;
        data.token = token;
        data.sessionId = verified.session.id;
        data.expiresAt = verified.session.expiresAt;
        next();
      })
      .catch(() => {
        next(new Error("unauthorized"));
      });
  });

  io.on("connection", (socket) => {
    const { user, token, sessionId, expiresAt } = socket.data as SocketData;
    const typingChannels = new Set<string>();
    let initialized = false;

    // Registrar é síncrono e acontece antes de qualquer await do callback.
    // Se a revogação venceu ainda no handshake, a tombstone abaixo impede a
    // inicialização; se vier depois desta linha, o registry já encontra o socket.
    sessionSockets.register(sessionId, socket);

    async function expireSession(): Promise<void> {
      beginSessionRevocation(options.sessionEvents, sessionId);

      try {
        await withSessionLock(options.sessionEvents, sessionId, async () => {
          markSessionRevoked(options.sessionEvents, sessionId);
          sessionSockets.disconnectSession(sessionId);
        });
      } catch {
        cancelSessionRevocation(options.sessionEvents, sessionId);
      }
    }

    let expiryTimer: NodeJS.Timeout;

    function scheduleExpiry(): NodeJS.Timeout {
      const remaining = expiresAt.getTime() - Date.now();

      if (remaining <= 0) {
        return setTimeout(() => void expireSession(), 0);
      }

      if (remaining > MAX_TIMEOUT_MS) {
        return setTimeout(() => {
          expiryTimer = scheduleExpiry();
        }, MAX_TIMEOUT_MS);
      }

      return setTimeout(() => void expireSession(), remaining);
    }

    expiryTimer = scheduleExpiry();

    function canContinue(): boolean {
      return (
        initialized &&
        socket.connected &&
        !isSessionRevoked(options.sessionEvents, sessionId)
      );
    }

    async function hasFreshSession(): Promise<boolean> {
      if (
        !socket.connected ||
        isSessionRevoked(options.sessionEvents, sessionId) ||
        isSessionRevocationPending(options.sessionEvents, sessionId)
      ) {
        return false;
      }

      try {
        const verified = await options.authService.verifySession(token);

        return (
          verified !== null &&
          verified.session.id === sessionId &&
          verified.user.id === user.id &&
          socket.connected &&
          !isSessionRevoked(options.sessionEvents, sessionId) &&
          !isSessionRevocationPending(options.sessionEvents, sessionId)
        );
      } catch {
        return false;
      }
    }

    function rejectUnauthorized(ack?: unknown): void {
      reply(ack, { error: "unauthorized" });
      if (socket.connected) {
        socket.disconnect(true);
      }
    }

    /**
     * Todos os eventos mutáveis da sessão passam pela mesma fila usada pelo
     * logout. O lock permanece adquirido durante os awaits e, no caso de
     * message:send, até depois do commit/broadcast/ACK. Isso dá uma ordem
     * explícita à corrida mensagem×logout, em vez de depender de um snapshot
     * de `socket.connected` que pode envelhecer durante o insert.
     */
    async function runProtected(
      ack: unknown,
      action: () => Promise<void>,
    ): Promise<void> {
      // Backpressure de revogação: eventos recebidos depois da intenção de
      // logout/expiração nem entram na cadeia de Promises da sessão.
      if (
        isSessionRevoked(options.sessionEvents, sessionId) ||
        isSessionRevocationPending(options.sessionEvents, sessionId)
      ) {
        rejectUnauthorized(ack);
        return;
      }

      try {
        await withSessionLock(options.sessionEvents, sessionId, async () => {
          if (
            isSessionRevocationPending(options.sessionEvents, sessionId) ||
            !canContinue() ||
            !(await hasFreshSession())
          ) {
            rejectUnauthorized(ack);
            return;
          }

          try {
            await action();
          } catch (error) {
            reply(ack, { error: errorCodeFor(error) });
          }
        });
      } catch {
        reply(ack, { error: "internal_error" });
      }
    }

    // Segunda validação dentro do coordenador fecha a corrida entre o
    // middleware do handshake e o registro/inicialização deste socket.
    void withSessionLock(options.sessionEvents, sessionId, async () => {
      if (!(await hasFreshSession())) {
        rejectUnauthorized();
        return;
      }

      await options.chatService.ensureMembership(user.id);

      if (!socket.connected || isSessionRevoked(options.sessionEvents, sessionId)) {
        if (socket.connected) {
          socket.disconnect(true);
        }
        return;
      }

      initialized = true;
      const becameOnline = presence.add(user.id, socket.id);

      socket.emit("connection:ack", {
        userId: user.id,
        onlineUserIds: presence.onlineUserIds(),
      });

      if (becameOnline) {
        socket.broadcast.emit("presence:update", {
          userId: user.id,
          online: true,
        });
      }
    }).catch(() => {
      if (socket.connected) {
        socket.disconnect(true);
      }
    });

    socket.on("channel:join", (payload: unknown, ack?: unknown) => {
      const parsed = joinChannelSchema.safeParse(payload);

      if (!parsed.success) {
        reply(ack, { error: "invalid_payload" });
        return;
      }

      void runProtected(ack, async () => {
        const { channel } = await options.chatService.assertTextChannel(
          parsed.data.channelSlug,
          user.id,
        );

        if (!canContinue()) {
          return;
        }

        await socket.join(roomName(channel.name));
        reply(ack, { ok: true });
      });
    });

    socket.on("message:send", (payload: unknown, ack?: unknown) => {
      const parsed = sendMessageSchema.safeParse(payload);

      if (!parsed.success) {
        reply(ack, { error: "invalid_payload" });
        return;
      }

      void runProtected(ack, async () => {
        const result = await options.chatService.createMessage({
          channelSlug: parsed.data.channelSlug,
          authorId: user.id,
          content: parsed.data.content,
          ...(parsed.data.clientMessageId === undefined
            ? {}
            : { clientMessageId: parsed.data.clientMessageId }),
        });

        // Um evento externo que não respeite o coordenador ainda pode fechar
        // o transporte durante um await. Não publique efeitos tardios nesse caso.
        if (!canContinue()) {
          return;
        }

        if (result.created) {
          io.to(roomName(result.message.channelSlug)).emit("message:new", result.message);
        }
        reply(ack, { ok: true });
      });
    });

    socket.on("typing:start", (payload: unknown) => {
      const parsed = typingSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      void runProtected(undefined, async () => {
        await options.chatService.assertTextChannel(parsed.data.channelSlug, user.id);

        if (!canContinue()) {
          return;
        }

        typingChannels.add(parsed.data.channelSlug);
        const becameTyping = typing.start(parsed.data.channelSlug, user.id, socket.id);

        if (becameTyping) {
          socket.to(roomName(parsed.data.channelSlug)).emit("typing:update", {
            channelSlug: parsed.data.channelSlug,
            userId: user.id,
            username: user.username,
            typing: true,
          });
        }
      });
    });

    socket.on("typing:stop", (payload: unknown) => {
      const parsed = typingSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      void runProtected(undefined, async () => {
        // Stop também valida o tipo: um cliente não pode fabricar updates em
        // canais VOICE ou inexistentes apenas porque já parou de digitar.
        await options.chatService.assertTextChannel(parsed.data.channelSlug, user.id);

        if (!canContinue()) {
          return;
        }

        typingChannels.delete(parsed.data.channelSlug);
        const stoppedTyping = typing.stop(parsed.data.channelSlug, user.id, socket.id);

        if (stoppedTyping) {
          socket.to(roomName(parsed.data.channelSlug)).emit("typing:update", {
            channelSlug: parsed.data.channelSlug,
            userId: user.id,
            username: user.username,
            typing: false,
          });
        }
      });
    });

    socket.on("disconnect", () => {
      initialized = false;
      clearTimeout(expiryTimer);
      sessionSockets.unregister(sessionId, socket);

      for (const channelSlug of typingChannels) {
        const stoppedTyping = typing.stop(channelSlug, user.id, socket.id);

        if (stoppedTyping) {
          socket.to(roomName(channelSlug)).emit("typing:update", {
            channelSlug,
            userId: user.id,
            username: user.username,
            typing: false,
          });
        }
      }

      typingChannels.clear();

      const becameOffline = presence.remove(user.id, socket.id);

      if (becameOffline) {
        socket.broadcast.emit("presence:update", {
          userId: user.id,
          online: false,
        });
      }
    });
  });

  return io;
}
