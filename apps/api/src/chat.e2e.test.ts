import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

import { ChannelType, prisma, Role } from "@respawn/database";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { createApp } from "./app.js";
import {
  createAuthService,
  type AuthService,
  type PublicUser,
  type VerifiedSession,
} from "./modules/auth/auth.service.js";
import {
  beginSessionRevocation,
  isSessionRevocationPending,
  isSessionRevoked,
  markSessionRevoked,
  SESSION_REVOKED_EVENT,
  withSessionLock,
} from "./modules/auth/session-events.js";
import { attachChatGateway } from "./modules/chat/chat.gateway.js";
import {
  createChatService,
  type ChatService,
} from "./modules/chat/chat.service.js";

const JWT_SECRET = "respawn-chat-e2e-secret-with-more-than-thirty-two-bytes";
const PASSWORD = "Respawn-QA-2026!";
const LOCAL_DATABASE_URL =
  "postgresql://respawn:respawn_local_password@127.0.0.1:5432/respawn?schema=public";
const CORS_ORIGIN = "http://localhost:5173";
const DEFAULT_SERVER_NAME = "Respawn HQ";

interface RegisteredUser {
  email: string;
  token: string;
  sessionId: string;
  userId: string;
  username: string;
}

let httpServer: HttpServer | undefined;
let baseUrl = "";
let cleanupEmails: string[] = [];
// A suíte roda sobre o banco local de verdade (mesmo padrão de
// auth.e2e.test.ts), que pode já ter um "Respawn HQ" de uso real/rodadas
// anteriores. Só apagamos o servidor padrão no after() se foi ESTA suíte que
// o criou do zero (banco recém-migrado) — nesse caso o usuário que o criou
// fica travado como owner (onDelete: Restrict) até o servidor ser removido
// também, então isso é necessário para não deixar nenhum usuário de teste
// órfão e impossível de apagar.
let defaultServerExistedBeforeSuite = true;
const openSockets = new Set<ClientSocket>();

async function requestJson(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const responseText = await response.text();

  return {
    response,
    body: responseText ? (JSON.parse(responseText) as unknown) : null,
  };
}

async function registerUser(tag: string): Promise<RegisteredUser> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `chat-e2e-${tag}-${suffix}@respawn.local`;
  cleanupEmails.push(email);

  const { response, body } = await requestJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      username: `chate2e${tag}${suffix}`.slice(0, 32),
      password: PASSWORD,
    }),
  });

  assert.equal(response.status, 201, `registro falhou para ${tag}: ${JSON.stringify(body)}`);

  const data = (
    body as {
      data: { user: { id: string; username: string }; session: { id: string }; token: string };
    }
  ).data;

  return {
    email,
    token: data.token,
    sessionId: data.session.id,
    userId: data.user.id,
    username: data.user.username,
  };
}

function connectSocket(token: string | undefined): ClientSocket {
  const socket = ioClient(baseUrl, {
    auth: token === undefined ? {} : { token },
    reconnection: false,
    timeout: 5_000,
  });
  openSockets.add(socket);
  return socket;
}

function waitForConnectionAck(socket: ClientSocket, timeoutMs = 5_000): Promise<{
  userId: string;
  onlineUserIds: string[];
}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout aguardando connection:ack")),
      timeoutMs,
    );

    socket.once("connection:ack", (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForConnectError(socket: ClientSocket, timeoutMs = 5_000): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout aguardando connect_error")),
      timeoutMs,
    );

    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      resolve(error);
    });
    socket.once("connection:ack", () => {
      clearTimeout(timer);
      reject(new Error("conectou quando deveria ter sido rejeitado"));
    });
  });
}

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ${event}`)), timeoutMs);

    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitWithAck<T = unknown>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ack de ${event}`)), timeoutMs);

    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function controlledUser(id = randomUUID()): PublicUser {
  return {
    id,
    email: `${id}@controlled.local`,
    username: `controlled-${id.slice(0, 8)}`,
    displayName: null,
    avatarUrl: null,
    createdAt: new Date(),
  };
}

function controlledSession(user: PublicUser, sessionId = randomUUID()): VerifiedSession {
  return {
    user,
    session: {
      id: sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

function stubAuthService(
  verifySession: AuthService["verifySession"],
): AuthService {
  const unsupported = async (): Promise<never> => {
    throw new Error("operação não usada pelo harness controlado");
  };

  return {
    register: unsupported,
    login: unsupported,
    verifySession,
    logout: async () => undefined,
  };
}

function stubChatService(overrides: Partial<ChatService> = {}): ChatService {
  const service: ChatService = {
    ensureMembership: async () => ({ serverId: "controlled-server", role: Role.NOVATO }),
    assertTextChannel: async (channelSlug) => ({
      channel: {
        id: `controlled-${channelSlug}`,
        serverId: "controlled-server",
        name: channelSlug,
        type: ChannelType.TEXT,
      },
      role: Role.NOVATO,
    }),
    assertVoiceChannel: async (channelSlug) => ({
      channel: {
        id: `controlled-${channelSlug}`,
        serverId: "controlled-server",
        name: channelSlug,
        type: ChannelType.VOICE,
      },
      role: Role.NOVATO,
    }),
    listMessages: async () => [],
    createMessage: async (input) => ({
      created: true,
      message: {
        id: randomUUID(),
        channelSlug: input.channelSlug,
        content: input.content,
        createdAt: new Date().toISOString(),
        author: {
          id: input.authorId,
          username: "controlled",
          displayName: null,
          avatarUrl: null,
          role: Role.NOVATO,
        },
      },
    }),
    listMembers: async () => [],
  };

  return { ...service, ...overrides };
}

async function startControlledGateway(
  authService: AuthService,
  chatService: ChatService,
  sessionEvents: EventEmitter,
): Promise<{
  io: ReturnType<typeof attachChatGateway>;
  url: string;
}> {
  const server = createServer();
  const io = attachChatGateway(server, {
    corsOrigin: CORS_ORIGIN,
    authService,
    chatService,
    sessionEvents,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { io, url: `http://127.0.0.1:${address.port}` };
}

async function closeControlledGateway(
  io: ReturnType<typeof attachChatGateway>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    io.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

before(async () => {
  const databaseHostname = new URL(
    process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  ).hostname;
  assert.ok(
    databaseHostname === "127.0.0.1" || databaseHostname === "localhost",
    "O teste E2E de chat aceita somente um PostgreSQL local.",
  );

  const preexistingServer = await prisma.server.findUnique({
    where: { name: DEFAULT_SERVER_NAME },
    select: { id: true },
  });
  defaultServerExistedBeforeSuite = preexistingServer !== null;

  const sessionEvents = new EventEmitter();

  const app = createApp({
    jwtSecret: JWT_SECRET,
    jwtTtlSeconds: 60 * 60,
    corsOrigin: CORS_ORIGIN,
    sessionEvents,
    livekit: { apiKey: "test-key", apiSecret: "test-secret", url: "ws://127.0.0.1:7880" },
  });
  httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  attachChatGateway(httpServer, {
    corsOrigin: CORS_ORIGIN,
    authService: createAuthService({ jwtSecret: JWT_SECRET, jwtTtlSeconds: 60 * 60 }),
    chatService: createChatService(),
    sessionEvents,
  });
});

after(async () => {
  for (const socket of openSockets) {
    socket.close();
  }

  if (cleanupEmails.length > 0) {
    await prisma.message.deleteMany({ where: { author: { email: { in: cleanupEmails } } } });
  }

  if (!defaultServerExistedBeforeSuite) {
    // Esta suíte criou o "Respawn HQ" do zero — desfaz por completo (cascade
    // cuida de canais/memberships/mensagens) para não deixar rastro e para
    // que o usuário que por acaso ganhou a corrida de criação (ownerId,
    // onDelete: Restrict) possa ser apagado normalmente a seguir.
    await prisma.server.deleteMany({ where: { name: DEFAULT_SERVER_NAME } });
  }

  if (cleanupEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: cleanupEmails } } });
  }

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve());
    });
  }

  await prisma.$disconnect();
});

test("handshake rejeita conexão sem token e com token inválido", async () => {
  const withoutToken = connectSocket(undefined);
  const errorWithoutToken = await waitForConnectError(withoutToken);
  assert.match(errorWithoutToken.message, /unauthorized/);
  withoutToken.close();

  const withBadToken = connectSocket("token-completamente-invalido");
  const errorWithBadToken = await waitForConnectError(withBadToken);
  assert.match(errorWithBadToken.message, /unauthorized/);
  withBadToken.close();
});

test(
  "QA-F2-001: ack malformado não derruba o processo e outros clientes continuam funcionando",
  async () => {
    const user = await registerUser("ack");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);

    // Um cliente autenticado pode mandar qualquer coisa no lugar do
    // callback de ack. Nenhuma dessas chamadas deve gerar um TypeError não
    // tratado no processo do servidor.
    socket.emit("channel:join", { channelSlug: "chat-geral" }, "nao-e-uma-funcao");
    socket.emit("channel:join", { channelSlug: "chat-geral" }, 42);
    socket.emit("channel:join", { channelSlug: "chat-geral" }, { fake: "ack" });
    socket.emit("message:send", { channelSlug: "chat-geral", content: "x" }, "tambem-invalido");
    socket.emit("message:send", { channelSlug: "chat-geral", content: "y" }, []);

    // Payloads propositalmente inválidos, ainda com um ack de verdade —
    // devem responder com erro em vez de travar ou lançar.
    const invalidPayloadAck = await emitWithAck<{ error: string }>(
      socket,
      "message:send",
      { channelSlug: 123, content: null },
    );
    assert.equal(invalidPayloadAck.error, "invalid_payload");

    // Se o processo tivesse morrido, esta chamada nunca respoderia.
    const joinAck = await emitWithAck<{ ok: true }>(socket, "channel:join", {
      channelSlug: "chat-geral",
    });
    assert.deepEqual(joinAck, { ok: true });

    // Um segundo cliente, totalmente independente, ainda consegue operar
    // normalmente depois de todo o lixo enviado acima.
    const otherUser = await registerUser("ack-peer");
    const otherSocket = connectSocket(otherUser.token);
    await waitForConnectionAck(otherSocket);
    await emitWithAck<{ ok: true }>(otherSocket, "channel:join", { channelSlug: "chat-geral" });
    const sendAck = await emitWithAck<{ ok: true }>(otherSocket, "message:send", {
      channelSlug: "chat-geral",
      content: "ainda funciona depois de ack malformado",
    });
    assert.deepEqual(sendAck, { ok: true });

    socket.close();
    otherSocket.close();
  },
);

test(
  "QA-F2-002/003: cursor afterCreatedAt/afterId sincroniza mensagens perdidas sem duplicar",
  async () => {
    const user = await registerUser("resync");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "party-up" });

    const sent: { id: string; createdAt: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const messagePromise = waitForEvent<{ id: string; createdAt: string }>(
        socket,
        "message:new",
      );
      await emitWithAck(socket, "message:send", {
        channelSlug: "party-up",
        content: `resync-${i}-${randomUUID()}`,
      });
      sent.push(await messagePromise);
    }

    const afterFirst = await requestJson(
      `/api/chat/channels/party-up/messages?afterCreatedAt=${encodeURIComponent(sent[0]!.createdAt)}&afterId=${sent[0]!.id}`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );
    assert.equal(afterFirst.response.status, 200);
    const afterFirstIds = (afterFirst.body as { data: { id: string }[] }).data.map((m) => m.id);
    assert.deepEqual(afterFirstIds, [sent[1]!.id, sent[2]!.id]);

    const afterLast = await requestJson(
      `/api/chat/channels/party-up/messages?afterCreatedAt=${encodeURIComponent(sent[2]!.createdAt)}&afterId=${sent[2]!.id}`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );
    assert.equal(afterLast.response.status, 200);
    assert.deepEqual((afterLast.body as { data: unknown[] }).data, []);

    socket.close();
  },
);

test(
  "QA-F2-002: reconectar (novo socket) reentra na sala e volta a receber broadcasts",
  async () => {
    const userA = await registerUser("reconnect-a");
    const userB = await registerUser("reconnect-b");

    const socketA1 = connectSocket(userA.token);
    const socketB = connectSocket(userB.token);
    await Promise.all([waitForConnectionAck(socketA1), waitForConnectionAck(socketB)]);
    await Promise.all([
      emitWithAck(socketA1, "channel:join", { channelSlug: "clips-e-highlights" }),
      emitWithAck(socketB, "channel:join", { channelSlug: "clips-e-highlights" }),
    ]);

    const firstMessage = waitForEvent(socketB, "message:new");
    await emitWithAck(socketA1, "message:send", {
      channelSlug: "clips-e-highlights",
      content: "antes de cair",
    });
    await firstMessage;

    // Simula a queda de conexão de A: fecha o socket (as salas do lado do
    // servidor são descartadas) e abre um novo socket para o mesmo usuário,
    // como o socket.io-client faria numa reconexão automática.
    socketA1.close();
    await delay(200);

    const socketA2 = connectSocket(userA.token);
    await waitForConnectionAck(socketA2);
    await emitWithAck(socketA2, "channel:join", { channelSlug: "clips-e-highlights" });

    const secondMessage = waitForEvent(socketB, "message:new");
    await emitWithAck(socketA2, "message:send", {
      channelSlug: "clips-e-highlights",
      content: "depois de reconectar",
    });
    const receivedAfterReconnect = await secondMessage;
    assert.equal(
      (receivedAfterReconnect as { content: string }).content,
      "depois de reconectar",
    );

    socketA2.close();
    socketB.close();
  },
);

test(
  "QA-F2-004: desconectar antes de ensureMembership resolver não deixa presença fantasma",
  async () => {
    const throwaway = await registerUser("ghost");
    const raceSocket = connectSocket(throwaway.token);
    // Fecha o socket imediatamente, antes que o handshake/ensureMembership
    // no servidor tenha qualquer chance de terminar.
    raceSocket.close();

    await delay(600);

    const observer = await registerUser("ghost-observer");
    const observerSocket = connectSocket(observer.token);
    const ack = await waitForConnectionAck(observerSocket);

    assert.equal(
      ack.onlineUserIds.includes(throwaway.userId),
      false,
      "usuário que caiu antes de ensureMembership resolver não deveria aparecer online",
    );

    observerSocket.close();
  },
);

test(
  "QA-F2-005: digitando é limpo quando o socket cai sem enviar typing:stop",
  async () => {
    const userA = await registerUser("typing-a");
    const userB = await registerUser("typing-b");

    const socketA = connectSocket(userA.token);
    const socketB = connectSocket(userB.token);
    await Promise.all([waitForConnectionAck(socketA), waitForConnectionAck(socketB)]);
    await Promise.all([
      emitWithAck(socketA, "channel:join", { channelSlug: "spawn-point" }),
      emitWithAck(socketB, "channel:join", { channelSlug: "spawn-point" }),
    ]);

    const typingStarted = waitForEvent<{ userId: string; typing: boolean }>(
      socketB,
      "typing:update",
    );
    socketA.emit("typing:start", { channelSlug: "spawn-point" });
    const startedPayload = await typingStarted;
    assert.equal(startedPayload.userId, userA.userId);
    assert.equal(startedPayload.typing, true);

    const typingStopped = waitForEvent<{ userId: string; typing: boolean }>(
      socketB,
      "typing:update",
    );
    // Fecha abruptamente sem nunca emitir typing:stop.
    socketA.close();
    const stoppedPayload = await typingStopped;
    assert.equal(stoppedPayload.userId, userA.userId);
    assert.equal(stoppedPayload.typing, false);

    socketB.close();
  },
);

test(
  "QA-F2-005b: typing é agregado por usuário entre sockets e só para no último stop",
  async () => {
    const user = await registerUser("typing-multi");
    const observer = await registerUser("typing-multi-observer");
    const secondLogin = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    assert.equal(secondLogin.response.status, 200);
    const secondToken = (secondLogin.body as { data: { token: string } }).data.token;

    const firstSocket = connectSocket(user.token);
    const secondSocket = connectSocket(secondToken);
    const observerSocket = connectSocket(observer.token);
    await Promise.all([
      waitForConnectionAck(firstSocket),
      waitForConnectionAck(secondSocket),
      waitForConnectionAck(observerSocket),
    ]);
    await Promise.all([
      emitWithAck(firstSocket, "channel:join", { channelSlug: "spawn-point" }),
      emitWithAck(secondSocket, "channel:join", { channelSlug: "spawn-point" }),
      emitWithAck(observerSocket, "channel:join", { channelSlug: "spawn-point" }),
    ]);

    const transitions: boolean[] = [];
    observerSocket.on(
      "typing:update",
      (payload: { userId: string; typing: boolean }) => {
        if (payload.userId === user.userId) {
          transitions.push(payload.typing);
        }
      },
    );

    firstSocket.emit("typing:start", { channelSlug: "spawn-point" });
    secondSocket.emit("typing:start", { channelSlug: "spawn-point" });
    await delay(250);
    assert.deepEqual(transitions, [true]);

    firstSocket.emit("typing:stop", { channelSlug: "spawn-point" });
    await delay(250);
    assert.deepEqual(
      transitions,
      [true],
      "uma aba não pode anunciar false enquanto a outra continua digitando",
    );

    secondSocket.emit("typing:stop", { channelSlug: "spawn-point" });
    await delay(250);
    assert.deepEqual(transitions, [true, false]);

    // `typing:stop` também precisa validar canal TEXT; canal VOICE não pode
    // fabricar uma transição pública nem derrubar o socket.
    firstSocket.emit("typing:stop", { channelSlug: "lobby-neon" });
    await delay(150);
    assert.deepEqual(transitions, [true, false]);
    assert.equal(firstSocket.connected, true);

    firstSocket.close();
    secondSocket.close();
    observerSocket.close();
  },
);

test(
  "QA-F2-006: sessão revogada direto no banco para de conseguir enviar mensagens (caminho reativo)",
  async () => {
    const user = await registerUser("revoked");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "spawn-point" });

    const baseline = await emitWithAck<{ ok: true }>(socket, "message:send", {
      channelSlug: "spawn-point",
      content: "antes da revogação",
    });
    assert.deepEqual(baseline, { ok: true });

    // Revogação direto no banco (sem passar por /logout) simula, por
    // exemplo, uma ação administrativa — não dispara SESSION_REVOKED_EVENT,
    // então a desconexão só acontece de forma reativa, na próxima ação.
    await prisma.session.update({
      where: { id: user.sessionId },
      data: { revokedAt: new Date() },
    });

    const disconnectPromise = waitForEvent(socket, "disconnect");
    const revokedAck = await emitWithAck<{ error: string }>(socket, "message:send", {
      channelSlug: "spawn-point",
      content: "depois da revogação — não deveria persistir",
    });
    assert.equal(revokedAck.error, "unauthorized");
    await disconnectPromise;

    const persisted = await prisma.message.findFirst({
      where: { content: "depois da revogação — não deveria persistir" },
    });
    assert.equal(persisted, null);
  },
);

test(
  "QA-F2-013a: sessão revogada é bloqueada em channel:join e typing:start, não só em message:send",
  async () => {
    const user = await registerUser("guard-all-events");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);

    await prisma.session.update({
      where: { id: user.sessionId },
      data: { revokedAt: new Date() },
    });

    const disconnectPromise = waitForEvent(socket, "disconnect");
    const joinAck = await emitWithAck<{ error: string }>(socket, "channel:join", {
      channelSlug: "spawn-point",
    });
    assert.equal(joinAck.error, "unauthorized");
    await disconnectPromise;
  },
);

test(
  "QA-F2-013b: POST /api/auth/logout desconecta o socket na hora, sem precisar tentar enviar nada",
  async () => {
    const userA = await registerUser("logout-a");
    const userB = await registerUser("logout-b");

    const socketA = connectSocket(userA.token);
    const socketB = connectSocket(userB.token);
    await Promise.all([waitForConnectionAck(socketA), waitForConnectionAck(socketB)]);
    await Promise.all([
      emitWithAck(socketA, "channel:join", { channelSlug: "spawn-point" }),
      emitWithAck(socketB, "channel:join", { channelSlug: "spawn-point" }),
    ]);

    let sawLateActivityFromA = false;
    socketB.on("typing:update", (update: { userId: string }) => {
      if (update.userId === userA.userId) sawLateActivityFromA = true;
    });
    socketB.on("message:new", (message: { author: { id: string } }) => {
      if (message.author.id === userA.userId) sawLateActivityFromA = true;
    });

    const disconnectPromise = waitForEvent(socketA, "disconnect");

    const logoutResponse = await requestJson("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    assert.equal(logoutResponse.response.status, 204);

    // Desconecta sozinho — nenhuma tentativa de enviar mensagem foi feita.
    await disconnectPromise;
    assert.equal(socketA.connected, false);

    // Uma segunda "aba" com o mesmo token (já revogado) também não entra.
    const secondAttempt = connectSocket(userA.token);
    const secondAttemptError = await waitForConnectError(secondAttempt);
    assert.match(secondAttemptError.message, /unauthorized/);

    await delay(300);
    assert.equal(
      sawLateActivityFromA,
      false,
      "B não deveria receber nenhum evento de A depois do logout",
    );

    socketB.close();
  },
);

test(
  "QA-F2-016a: revogação entre verifySession do handshake e registry não deixa o socket inicializar",
  async () => {
    const sessionEvents = new EventEmitter();
    const user = controlledUser();
    const verified = controlledSession(user);
    let verifyCalls = 0;
    let ensureMembershipCalls = 0;

    const authService = stubAuthService(async () => {
      verifyCalls += 1;

      if (verifyCalls === 1) {
        // O snapshot válido já foi produzido, mas a revogação acontece numa
        // microtask antes do `.then(next)` do middleware registrar o socket.
        queueMicrotask(() => {
          markSessionRevoked(sessionEvents, verified.session.id);
          sessionEvents.emit(SESSION_REVOKED_EVENT, {
            sessionId: verified.session.id,
          });
        });
        return verified;
      }

      return null;
    });
    const chatService = stubChatService({
      ensureMembership: async () => {
        ensureMembershipCalls += 1;
        return { serverId: "controlled-server", role: Role.NOVATO };
      },
    });
    const harness = await startControlledGateway(
      authService,
      chatService,
      sessionEvents,
    );
    const socket = ioClient(harness.url, {
      auth: { token: "controlled-token" },
      reconnection: false,
      autoConnect: false,
    });
    let connectionAcks = 0;
    socket.on("connection:ack", () => {
      connectionAcks += 1;
    });
    const disconnected = waitForEvent(socket, "disconnect");

    socket.connect();
    await disconnected;
    await delay(50);

    assert.equal(connectionAcks, 0);
    assert.equal(ensureMembershipCalls, 0);
    assert.equal(verifyCalls, 1, "tombstone deve barrar a segunda consulta antes do bootstrap");

    socket.close();
    await closeControlledGateway(harness.io);
  },
);

test(
  "QA-F2-016b: message:send iniciado antes do logout termina numa ordem explícita antes da revogação",
  async () => {
    const sessionEvents = new EventEmitter();
    const user = controlledUser();
    const verified = controlledSession(user);
    let active = true;
    let createCalls = 0;
    const insertEntered = deferredSignal();
    const releaseInsert = deferredSignal();
    const order: string[] = [];
    const baselineChat = stubChatService();
    const chatService = stubChatService({
      createMessage: async (input) => {
        createCalls += 1;
        order.push("message:insert:start");
        insertEntered.resolve();
        await releaseInsert.promise;
        order.push("message:insert:end");
        return baselineChat.createMessage(input);
      },
    });
    const harness = await startControlledGateway(
      stubAuthService(async () => (active ? verified : null)),
      chatService,
      sessionEvents,
    );
    const socket = ioClient(harness.url, {
      auth: { token: "controlled-token" },
      reconnection: false,
    });
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "spawn-point" });

    const sendAcknowledgement = emitWithAck<{ ok: true }>(socket, "message:send", {
      channelSlug: "spawn-point",
      content: "mensagem que já ganhou a linearização",
      clientMessageId: randomUUID(),
    });
    await insertEntered.promise;

    let logoutFinished = false;
    const disconnected = waitForEvent(socket, "disconnect");
    beginSessionRevocation(sessionEvents, verified.session.id);
    const logout = withSessionLock(
      sessionEvents,
      verified.session.id,
      async () => {
        order.push("logout:start");
        active = false;
        markSessionRevoked(sessionEvents, verified.session.id);
        logoutFinished = true;
        order.push("logout:end");
      },
    ).then(() => {
      sessionEvents.emit(SESSION_REVOKED_EVENT, { sessionId: verified.session.id });
    });

    await delay(75);
    assert.equal(logoutFinished, false, "logout deve aguardar o insert que ganhou o lock");
    assert.equal(socket.connected, true);

    releaseInsert.resolve();
    assert.deepEqual(await sendAcknowledgement, { ok: true });
    await logout;
    await disconnected;

    assert.equal(createCalls, 1);
    assert.deepEqual(order, [
      "message:insert:start",
      "message:insert:end",
      "logout:start",
      "logout:end",
    ]);

    socket.close();
    await closeControlledGateway(harness.io);
  },
);

test(
  "QA-F2-016c: logout que ganha o lock impede message:send já recebido de chegar ao insert",
  async () => {
    const sessionEvents = new EventEmitter();
    const user = controlledUser();
    const verified = controlledSession(user);
    let active = true;
    let createCalls = 0;
    const logoutEntered = deferredSignal();
    const releaseLogout = deferredSignal();
    const messageReachedServer = deferredSignal();
    const chatService = stubChatService({
      createMessage: async (input) => {
        createCalls += 1;
        return stubChatService().createMessage(input);
      },
    });
    const harness = await startControlledGateway(
      stubAuthService(async () => (active ? verified : null)),
      chatService,
      sessionEvents,
    );
    harness.io.on("connection", (serverSocket) => {
      serverSocket.on("message:send", () => messageReachedServer.resolve());
    });
    const socket = ioClient(harness.url, {
      auth: { token: "controlled-token" },
      reconnection: false,
    });
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "spawn-point" });

    const disconnected = waitForEvent(socket, "disconnect");
    beginSessionRevocation(sessionEvents, verified.session.id);
    const logout = withSessionLock(sessionEvents, verified.session.id, async () => {
      logoutEntered.resolve();
      await releaseLogout.promise;
      active = false;
      markSessionRevoked(sessionEvents, verified.session.id);
    }).then(() => {
      sessionEvents.emit(SESSION_REVOKED_EVENT, { sessionId: verified.session.id });
    });
    await logoutEntered.promise;

    socket.emit("message:send", {
      channelSlug: "spawn-point",
      content: "não pode alcançar o insert",
      clientMessageId: randomUUID(),
    });
    await messageReachedServer.promise;
    releaseLogout.resolve();

    await logout;
    await disconnected;
    await delay(75);
    assert.equal(createCalls, 0);

    socket.close();
    await closeControlledGateway(harness.io);
  },
);

test(
  "QA-F2-016d: evento externo durante insert fica pendente, deixa o vencedor concluir e então revoga",
  async () => {
    const sessionEvents = new EventEmitter();
    const user = controlledUser();
    const verified = controlledSession(user);
    const insertEntered = deferredSignal();
    const releaseInsert = deferredSignal();
    let createCalls = 0;
    const baselineChat = stubChatService();
    const chatService = stubChatService({
      createMessage: async (input) => {
        createCalls += 1;
        insertEntered.resolve();
        await releaseInsert.promise;
        return baselineChat.createMessage(input);
      },
    });
    const harness = await startControlledGateway(
      stubAuthService(async () => verified),
      chatService,
      sessionEvents,
    );
    const socket = ioClient(harness.url, {
      auth: { token: "controlled-token" },
      reconnection: false,
    });
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "spawn-point" });

    const sendAcknowledgement = emitWithAck<{ ok: true }>(socket, "message:send", {
      channelSlug: "spawn-point",
      content: "operação anterior ao evento externo",
      clientMessageId: randomUUID(),
    });
    await insertEntered.promise;
    const disconnected = waitForEvent(socket, "disconnect");

    sessionEvents.emit(SESSION_REVOKED_EVENT, { sessionId: verified.session.id });
    assert.equal(
      isSessionRevocationPending(sessionEvents, verified.session.id),
      true,
    );
    await delay(75);
    assert.equal(socket.connected, true, "evento externo deve respeitar o dono atual do lock");

    releaseInsert.resolve();
    assert.deepEqual(await sendAcknowledgement, { ok: true });
    await disconnected;

    assert.equal(createCalls, 1);
    assert.equal(isSessionRevoked(sessionEvents, verified.session.id), true);
    assert.equal(
      isSessionRevocationPending(sessionEvents, verified.session.id),
      false,
    );

    socket.close();
    await closeControlledGateway(harness.io);
  },
);

test(
  "QA-F2-016e: expiração agenda revogação e desconecta proativamente sem nova ação",
  async () => {
    const sessionEvents = new EventEmitter();
    const user = controlledUser();
    const verified = controlledSession(user);
    verified.session.expiresAt = new Date(Date.now() + 400);
    let createCalls = 0;
    const baselineChat = stubChatService();
    const harness = await startControlledGateway(
      stubAuthService(async () => verified),
      stubChatService({
        createMessage: async (input) => {
          createCalls += 1;
          return baselineChat.createMessage(input);
        },
      }),
      sessionEvents,
    );
    const socket = ioClient(harness.url, {
      auth: { token: "controlled-token" },
      reconnection: false,
    });
    await waitForConnectionAck(socket);
    const disconnected = waitForEvent(socket, "disconnect", 2_000);

    await disconnected;
    assert.equal(socket.connected, false);
    assert.equal(isSessionRevoked(sessionEvents, verified.session.id), true);

    socket.emit("message:send", {
      channelSlug: "spawn-point",
      content: "não pode enviar depois de expirar",
    });
    await delay(75);
    assert.equal(createCalls, 0);

    socket.close();
    await closeControlledGateway(harness.io);
  },
);

test(
  "QA-F2-013c: revogar uma sessão não afeta outra aba/sessão do mesmo usuário",
  async () => {
    const user = await registerUser("multi-tab");

    // Um segundo login gera uma segunda sessão/token para o MESMO usuário —
    // simula uma segunda aba autenticada de forma independente.
    const secondLogin = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    assert.equal(secondLogin.response.status, 200);
    const secondToken = (secondLogin.body as { data: { token: string } }).data.token;

    const tabOne = connectSocket(user.token);
    const tabTwo = connectSocket(secondToken);
    await Promise.all([waitForConnectionAck(tabOne), waitForConnectionAck(tabTwo)]);

    const tabOneDisconnect = waitForEvent(tabOne, "disconnect");
    const logoutResponse = await requestJson("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
    });
    assert.equal(logoutResponse.response.status, 204);
    await tabOneDisconnect;

    // A outra sessão/aba continua funcionando normalmente.
    await emitWithAck(tabTwo, "channel:join", { channelSlug: "spawn-point" });
    const sendAck = await emitWithAck<{ ok: true }>(tabTwo, "message:send", {
      channelSlug: "spawn-point",
      content: "ainda funciono na outra aba",
    });
    assert.deepEqual(sendAck, { ok: true });

    tabTwo.close();
  },
);

test(
  "QA-F2-014: canais VOICE não aceitam channel:join nem message:send",
  async () => {
    const user = await registerUser("voice-block");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);

    const joinAck = await emitWithAck<{ error: string }>(socket, "channel:join", {
      channelSlug: "lobby-neon",
    });
    assert.equal(joinAck.error, "channel_not_text");

    const rejectedContent = `voice-block-${randomUUID()}`;
    const sendAck = await emitWithAck<{ error: string }>(socket, "message:send", {
      channelSlug: "lobby-neon",
      content: rejectedContent,
    });
    assert.equal(sendAck.error, "channel_not_text");

    const persisted = await prisma.message.count({ where: { content: rejectedContent } });
    assert.equal(persisted, 0);

    socket.close();
  },
);

test(
  "QA-F2-002 (idempotência): retry legítimo mantém uma linha e um único broadcast",
  async () => {
    const user = await registerUser("idempotent");
    const socket = connectSocket(user.token);
    await waitForConnectionAck(socket);
    await emitWithAck(socket, "channel:join", { channelSlug: "clips-e-highlights" });

    const clientMessageId = randomUUID();
    const content = `idempotencia-${randomUUID()}`;
    let broadcasts = 0;
    socket.on("message:new", (message: { content: string }) => {
      if (message.content === content) {
        broadcasts += 1;
      }
    });

    const firstAck = await emitWithAck<{ ok: true }>(socket, "message:send", {
      channelSlug: "clips-e-highlights",
      content,
      clientMessageId,
    });
    assert.deepEqual(firstAck, { ok: true });

    // Reenvio com o MESMO clientMessageId — simula um cliente que não viu o
    // primeiro ACK chegar (ex.: perda de rede) e tentou de novo.
    const secondAck = await emitWithAck<{ ok: true }>(socket, "message:send", {
      channelSlug: "clips-e-highlights",
      content,
      clientMessageId,
    });
    assert.deepEqual(secondAck, { ok: true });

    const count = await prisma.message.count({
      where: { authorId: user.userId, clientMessageId },
    });
    assert.equal(count, 1);
    await delay(150);
    assert.equal(broadcasts, 1, "retry não pode rebroadcastar a mensagem persistida");

    socket.close();
  },
);

test(
  "QA-F2-002 (idempotência sob corrida): retries por duas sessões geram uma linha e um broadcast",
  async () => {
    const user = await registerUser("idempotent-race");
    const secondLogin = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    assert.equal(secondLogin.response.status, 200);
    const secondToken = (secondLogin.body as { data: { token: string } }).data.token;

    const firstSocket = connectSocket(user.token);
    const secondSocket = connectSocket(secondToken);
    await Promise.all([
      waitForConnectionAck(firstSocket),
      waitForConnectionAck(secondSocket),
    ]);
    await Promise.all([
      emitWithAck(firstSocket, "channel:join", { channelSlug: "clips-e-highlights" }),
      emitWithAck(secondSocket, "channel:join", { channelSlug: "clips-e-highlights" }),
    ]);

    const clientMessageId = randomUUID();
    const content = `idempotencia-race-${randomUUID()}`;
    let broadcasts = 0;
    firstSocket.on("message:new", (message: { content: string }) => {
      if (message.content === content) {
        broadcasts += 1;
      }
    });

    const acknowledgements = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        emitWithAck<{ ok: true }>(
          index % 2 === 0 ? firstSocket : secondSocket,
          "message:send",
          {
            channelSlug: "clips-e-highlights",
            content,
            clientMessageId,
          },
        ),
      ),
    );
    for (const acknowledgement of acknowledgements) {
      assert.deepEqual(acknowledgement, { ok: true });
    }

    const count = await prisma.message.count({
      where: { authorId: user.userId, clientMessageId },
    });
    assert.equal(count, 1);
    await delay(150);
    assert.equal(broadcasts, 1, "somente o vencedor do insert pode emitir message:new");

    firstSocket.close();
    secondSocket.close();
  },
);

test(
  "QA-F2-015: reutilizar clientMessageId com canal/conteúdo divergentes retorna conflito sem vazamento",
  async () => {
    const user = await registerUser("idempotent-conflict");
    const observer = await registerUser("idempotent-conflict-observer");
    const senderSocket = connectSocket(user.token);
    const observerSocket = connectSocket(observer.token);
    await Promise.all([
      waitForConnectionAck(senderSocket),
      waitForConnectionAck(observerSocket),
    ]);
    await Promise.all([
      emitWithAck(senderSocket, "channel:join", { channelSlug: "spawn-point" }),
      emitWithAck(senderSocket, "channel:join", { channelSlug: "chat-geral" }),
      emitWithAck(observerSocket, "channel:join", { channelSlug: "chat-geral" }),
    ]);

    const clientMessageId = randomUUID();
    const originalContent = `idempotencia-origem-${randomUUID()}`;
    let destinationBroadcasts = 0;
    observerSocket.on("message:new", () => {
      destinationBroadcasts += 1;
    });

    const firstAck = await emitWithAck<{ ok: true }>(senderSocket, "message:send", {
      channelSlug: "spawn-point",
      content: originalContent,
      clientMessageId,
    });
    assert.deepEqual(firstAck, { ok: true });

    const crossChannelAck = await emitWithAck<{ error: string }>(
      senderSocket,
      "message:send",
      {
        channelSlug: "chat-geral",
        content: originalContent,
        clientMessageId,
      },
    );
    assert.equal(crossChannelAck.error, "idempotency_conflict");

    const changedContentAck = await emitWithAck<{ error: string }>(
      senderSocket,
      "message:send",
      {
        channelSlug: "spawn-point",
        content: `${originalContent}-alterado`,
        clientMessageId,
      },
    );
    assert.equal(changedContentAck.error, "idempotency_conflict");

    const rows = await prisma.message.findMany({
      where: { authorId: user.userId, clientMessageId },
      select: { content: true, channel: { select: { name: true } } },
    });
    assert.deepEqual(rows, [
      { content: originalContent, channel: { name: "spawn-point" } },
    ]);
    await delay(200);
    assert.equal(
      destinationBroadcasts,
      0,
      "retry divergente não pode rebroadcastar a linha original na sala solicitada",
    );

    senderSocket.close();
    observerSocket.close();
  },
);

test(
  "QA-F2-007: muitas conexões concorrentes não duplicam o servidor/canais padrão",
  async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) => registerUser(`bootstrap-${index}`)),
    );

    const sockets = users.map((user) => connectSocket(user.token));
    await Promise.all(sockets.map((socket) => waitForConnectionAck(socket)));

    const serverCount = await prisma.server.count({ where: { name: DEFAULT_SERVER_NAME } });
    assert.equal(serverCount, 1);

    const server = await prisma.server.findUniqueOrThrow({
      where: { name: DEFAULT_SERVER_NAME },
    });
    for (const channelName of [
      "spawn-point",
      "chat-geral",
      "party-up",
      "clips-e-highlights",
      "lobby-neon",
      "squad-alpha",
    ]) {
      const channelCount = await prisma.channel.count({
        where: { serverId: server.id, name: channelName },
      });
      assert.equal(channelCount, 1, `canal ${channelName} deveria existir exatamente uma vez`);
    }

    for (const socket of sockets) {
      socket.close();
    }
  },
);

test(
  "QA-F2-010: io.close() sozinho encerra o http server sem ERR_SERVER_NOT_RUNNING",
  async () => {
    // server.ts fecha o socket.io no shutdown, que por sua vez fecha o
    // http.Server que recebeu na criação. Uma segunda chamada a
    // server.close() depois disso é o bug do QA-F2-010 (exit code 1 mesmo
    // em SIGINT/SIGTERM normal) — este teste garante que io.close() sozinho
    // já é suficiente e não deixa o servidor "meio fechado".
    const plainServer = createServer();
    const isolatedSessionEvents = new EventEmitter();
    const io = attachChatGateway(plainServer, {
      corsOrigin: CORS_ORIGIN,
      authService: createAuthService({ jwtSecret: JWT_SECRET, jwtTtlSeconds: 60 * 60 }),
      chatService: createChatService(),
      sessionEvents: isolatedSessionEvents,
    });
    assert.equal(isolatedSessionEvents.listenerCount(SESSION_REVOKED_EVENT), 1);

    await new Promise<void>((resolve) => plainServer.listen(0, "127.0.0.1", resolve));
    assert.equal(plainServer.listening, true);

    const closeError = await new Promise<Error | undefined>((resolve) => {
      io.close((error) => resolve(error));
    });

    assert.equal(closeError, undefined);
    assert.equal(plainServer.listening, false);
    assert.equal(
      isolatedSessionEvents.listenerCount(SESSION_REVOKED_EVENT),
      0,
      "shutdown precisa remover o listener de revogação do gateway",
    );
  },
);
