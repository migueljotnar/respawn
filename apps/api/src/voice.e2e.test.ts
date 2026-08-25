import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { after, before, test } from "node:test";

import { prisma } from "@respawn/database";
import jwt from "jsonwebtoken";

import { createApp } from "./app.js";
import {
  isSessionRevocationPending,
  withSessionLock,
} from "./modules/auth/session-events.js";

const JWT_SECRET = "respawn-voice-e2e-secret-with-more-than-thirty-two-bytes";
const LIVEKIT_API_KEY = "voice-e2e-key";
const LIVEKIT_API_SECRET = "voice-e2e-secret-with-more-than-thirty-two-bytes";
const LIVEKIT_URL = "ws://127.0.0.1:7880";
const PASSWORD = "Respawn-QA-2026!";
const LOCAL_DATABASE_URL =
  "postgresql://respawn:respawn_local_password@127.0.0.1:5432/respawn?schema=public";
const CORS_ORIGIN = "http://localhost:5173";
const DEFAULT_SERVER_NAME = "Respawn HQ";

interface TokenEnvelope {
  data: { token: string; url: string; roomName: string };
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

let httpServer: HttpServer | undefined;
let baseUrl = "";
let cleanupEmails: string[] = [];
const sessionEvents = new EventEmitter();
// Mesma lógica hermética do chat.e2e.test.ts: só desfaz o "Respawn HQ" se
// esta suíte foi quem o criou (banco recém-migrado), senão deixaria um
// usuário de teste travado como owner (onDelete: Restrict).
let defaultServerExistedBeforeSuite = true;

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

async function registerUser(tag: string): Promise<{ email: string; token: string; userId: string }> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `voice-e2e-${tag}-${suffix}@respawn.local`;
  cleanupEmails.push(email);

  const { response, body } = await requestJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      username: `voicee2e${tag}${suffix}`.slice(0, 32),
      password: PASSWORD,
    }),
  });

  assert.equal(response.status, 201, `registro falhou para ${tag}: ${JSON.stringify(body)}`);

  const data = (body as { data: { user: { id: string }; token: string } }).data;
  return { email, token: data.token, userId: data.user.id };
}

before(async () => {
  const databaseHostname = new URL(
    process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  ).hostname;
  assert.ok(
    databaseHostname === "127.0.0.1" || databaseHostname === "localhost",
    "O teste E2E de voz aceita somente um PostgreSQL local.",
  );

  const preexistingServer = await prisma.server.findUnique({
    where: { name: DEFAULT_SERVER_NAME },
    select: { id: true },
  });
  defaultServerExistedBeforeSuite = preexistingServer !== null;

  const app = createApp({
    jwtSecret: JWT_SECRET,
    jwtTtlSeconds: 60 * 60,
    corsOrigin: CORS_ORIGIN,
    livekit: { apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL },
    sessionEvents,
  });
  httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (cleanupEmails.length > 0) {
    await prisma.message.deleteMany({ where: { author: { email: { in: cleanupEmails } } } });
  }

  if (!defaultServerExistedBeforeSuite) {
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

test("POST /api/voice/token exige autenticação", async () => {
  const { response, body } = await requestJson("/api/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelSlug: "lobby-neon" }),
  });

  assert.equal(response.status, 401);
  assert.equal((body as ErrorEnvelope).error.code, "INVALID_SESSION");
});

test(
  "POST /api/voice/token emite um token válido para um canal VOICE real",
  async () => {
    const user = await registerUser("valid");

    const { response, body } = await requestJson("/api/voice/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ channelSlug: "lobby-neon" }),
    });

    assert.equal(response.status, 200, JSON.stringify(body));
    const data = (body as TokenEnvelope).data;
    assert.equal(data.url, LIVEKIT_URL);
    assert.equal(data.roomName, "voice:lobby-neon");
    assert.equal(data.token.split(".").length, 3, "deve ser um JWT bem formado");

    const decoded = jwt.decode(data.token) as {
      sub?: string;
      video?: { room?: string; roomJoin?: boolean; canPublish?: boolean; canSubscribe?: boolean };
      name?: string;
      exp?: number;
      nbf?: number;
    } | null;

    assert.ok(decoded, "o token deve decodificar como JWT");
    assert.equal(decoded?.sub, user.userId);
    assert.equal(decoded?.video?.room, "voice:lobby-neon");
    assert.equal(decoded?.video?.roomJoin, true);
    assert.equal(decoded?.video?.canPublish, true);
    assert.equal(decoded?.video?.canSubscribe, true);
    assert.ok(decoded?.exp && decoded?.nbf, "o token deve declarar expiração e início");
    assert.ok(
      decoded.exp - decoded.nbf <= 10 * 60,
      "o token de conexão deve ter TTL curto de no máximo 10 minutos",
    );
    const sessionPayload = jwt.decode(user.token) as { exp?: number } | null;
    assert.ok(sessionPayload?.exp, "a sessão autorizadora deve declarar expiração");
    assert.ok(
      decoded.exp <= sessionPayload.exp,
      "o token LiveKit não pode sobreviver à sessão que o autorizou",
    );

    // O token tem que estar assinado com o segredo real do LiveKit
    // configurado no servidor — não pode ser um JWT qualquer.
    assert.doesNotThrow(() => jwt.verify(data.token, LIVEKIT_API_SECRET));
  },
);

test("POST /api/voice/token não emite token quando um logout já está pendente", async () => {
  const user = await registerUser("logout-race");
  const sessionPayload = jwt.decode(user.token) as { jti?: string } | null;
  assert.ok(sessionPayload?.jti, "a sessão de teste deve declarar jti");

  let releaseLock!: () => void;
  const lockBlocker = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let signalLockStarted!: () => void;
  const lockStarted = new Promise<void>((resolve) => {
    signalLockStarted = resolve;
  });
  const heldLock = withSessionLock(sessionEvents, sessionPayload.jti, async () => {
    signalLockStarted();
    await lockBlocker;
  });
  await lockStarted;

  const logoutRequest = requestJson("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.token}` },
  });

  const deadline = Date.now() + 2_000;
  while (!isSessionRevocationPending(sessionEvents, sessionPayload.jti)) {
    assert.ok(Date.now() < deadline, "o logout não entrou no estado pendente a tempo");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const tokenRequest = await requestJson("/api/voice/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({ channelSlug: "lobby-neon" }),
  });

  releaseLock();
  await heldLock;
  const logoutResult = await logoutRequest;

  assert.equal(logoutResult.response.status, 204);
  assert.equal(tokenRequest.response.status, 401);
  assert.equal((tokenRequest.body as ErrorEnvelope).error.code, "INVALID_SESSION");
});

test(
  "POST /api/voice/token rejeita um canal de TEXTO (spawn-point não é sala de voz)",
  async () => {
    const user = await registerUser("text-channel");

    const { response, body } = await requestJson("/api/voice/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ channelSlug: "spawn-point" }),
    });

    assert.equal(response.status, 403);
    assert.equal((body as ErrorEnvelope).error.code, "CHANNEL_NOT_VOICE");
  },
);

test(
  "POST /api/voice/token rejeita um canal inexistente",
  async () => {
    const user = await registerUser("missing-channel");

    const { response, body } = await requestJson("/api/voice/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ channelSlug: "canal-que-nao-existe" }),
    });

    assert.equal(response.status, 404);
    assert.equal((body as ErrorEnvelope).error.code, "CHANNEL_NOT_FOUND");
  },
);

test("POST /api/voice/token rejeita payload inválido", async () => {
  const user = await registerUser("bad-payload");

  const { response, body } = await requestJson("/api/voice/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({ channelSlug: "" }),
  });

  assert.equal(response.status, 400);
  assert.equal((body as ErrorEnvelope).error.code, "VALIDATION_ERROR");
});
