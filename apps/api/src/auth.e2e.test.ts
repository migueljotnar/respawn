import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

import { prisma } from "@respawn/database";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { createApp } from "./app.js";

const JWT_SECRET =
  "respawn-auth-e2e-secret-with-more-than-thirty-two-bytes";
const PASSWORD = "Respawn-QA-2026!";
const LOCAL_DATABASE_URL =
  "postgresql://respawn:respawn_local_password@127.0.0.1:5432/respawn?schema=public";

interface AuthEnvelope {
  data: {
    user: {
      id: string;
      email: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      createdAt: string;
    };
    session: {
      id: string;
      expiresAt: string;
    };
    token: string;
    tokenType: "Bearer";
  };
}

interface SessionEnvelope {
  data: {
    user: AuthEnvelope["data"]["user"];
    session: AuthEnvelope["data"]["session"];
  };
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

let server: Server | undefined;
let baseUrl = "";
let cleanupEmails: string[] = [];

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

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function tamperWithJwt(token: string): string {
  const [header, payload, signature] = token.split(".");

  assert.ok(header && payload && signature);
  const replacement = signature.startsWith("a") ? "b" : "a";

  return `${header}.${payload}.${replacement}${signature.slice(1)}`;
}

before(async () => {
  const databaseHostname = new URL(
    process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  ).hostname;
  assert.ok(
    databaseHostname === "127.0.0.1" || databaseHostname === "localhost",
    "O teste E2E de autenticação aceita somente um PostgreSQL local.",
  );

  const app = createApp({
    jwtSecret: JWT_SECRET,
    jwtTtlSeconds: 60 * 60,
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (cleanupEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: cleanupEmails } } });
  }

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await prisma.$disconnect();
});

test(
  "fluxo REST de registro, login e verificação de sessão",
  { timeout: 60_000 },
  async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createdEmail = `qa-${suffix}@respawn.local`;
    const duplicateUsernameEmail = `other-${suffix}@respawn.local`;
    cleanupEmails = [createdEmail, duplicateUsernameEmail];
    const username = `qa_${suffix}`;

    const invalidJson = await requestJson("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.response.status, 400);
    assert.equal((invalidJson.body as ErrorEnvelope).error.code, "INVALID_JSON");

    const excessivePayload = await requestJson("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17_000) }),
    });
    assert.equal(excessivePayload.response.status, 413);
    assert.equal(
      (excessivePayload.body as ErrorEnvelope).error.code,
      "PAYLOAD_TOO_LARGE",
    );

    const rejectedInternalFields = await requestJson(
      "/api/auth/register",
      jsonRequest({
        email: createdEmail,
        username,
        password: PASSWORD,
        role: "ADMIN",
        passwordHash: "not-allowed",
      }),
    );
    assert.equal(rejectedInternalFields.response.status, 400);
    assert.equal(
      (rejectedInternalFields.body as ErrorEnvelope).error.code,
      "VALIDATION_ERROR",
    );
    assert.equal(
      await prisma.user.count({ where: { email: createdEmail } }),
      0,
    );

    const invalidEmail = await requestJson(
      "/api/auth/register",
      jsonRequest({
        email: "invalid-email",
        username,
        password: PASSWORD,
      }),
    );
    assert.equal(invalidEmail.response.status, 400);

    const registration = await requestJson(
      "/api/auth/register",
      jsonRequest({
        email: createdEmail.toUpperCase(),
        username: username.toUpperCase(),
        displayName: "QA Respawn",
        password: PASSWORD,
      }),
    );
    assert.equal(registration.response.status, 201);
    assert.equal(registration.response.headers.get("cache-control"), "no-store");
    assert.equal(registration.response.headers.get("x-powered-by"), null);

    const registrationBody = registration.body as AuthEnvelope;
    assert.equal(registrationBody.data.user.email, createdEmail);
    assert.equal(registrationBody.data.user.username, username);
    assert.equal(registrationBody.data.tokenType, "Bearer");
    assert.equal(registrationBody.data.token.split(".").length, 3);
    assert.equal(
      JSON.stringify(registrationBody).toLowerCase().includes("password"),
      false,
    );
    assert.equal(JSON.stringify(registrationBody).includes(PASSWORD), false);
    assert.equal(
      JSON.stringify(registrationBody).includes("tokenHash"),
      false,
    );

    const persistedUser = await prisma.user.findUniqueOrThrow({
      where: { email: createdEmail },
    });
    assert.ok(persistedUser.passwordHash);
    assert.notEqual(persistedUser.passwordHash, PASSWORD);
    assert.equal(await bcrypt.compare(PASSWORD, persistedUser.passwordHash), true);
    assert.equal(bcrypt.getRounds(persistedUser.passwordHash), 12);

    const registrationJwt = jwt.verify(
      registrationBody.data.token,
      JWT_SECRET,
      {
        algorithms: ["HS256"],
        issuer: "respawn-api",
        audience: "respawn-web",
      },
    );
    if (typeof registrationJwt === "string") {
      assert.fail("O JWT de sessão deve possuir payload estruturado.");
    }

    assert.equal(registrationJwt.sub, registrationBody.data.user.id);
    assert.equal(registrationJwt.jti, registrationBody.data.session.id);
    assert.equal(registrationJwt.token_use, "session");
    assert.equal("email" in registrationJwt, false);
    assert.equal("passwordHash" in registrationJwt, false);

    const registrationSession = await prisma.session.findUniqueOrThrow({
      where: { id: registrationBody.data.session.id },
    });
    const expectedTokenHash = createHash("sha256")
      .update(registrationBody.data.token, "utf8")
      .digest("hex");
    assert.equal(registrationSession.tokenHash, expectedTokenHash);
    assert.equal(registrationSession.tokenHash.length, 64);
    assert.notEqual(registrationSession.tokenHash, registrationBody.data.token);
    assert.ok(registrationJwt.exp);
    assert.ok(
      Math.abs(
        registrationSession.expiresAt.getTime() - registrationJwt.exp * 1_000,
      ) <= 1,
    );

    const duplicateEmail = await requestJson(
      "/api/auth/register",
      jsonRequest({
        email: createdEmail.toUpperCase(),
        username: `${username}_other`,
        password: PASSWORD,
      }),
    );
    assert.equal(duplicateEmail.response.status, 409);
    assert.equal(
      (duplicateEmail.body as ErrorEnvelope).error.code,
      "ACCOUNT_CONFLICT",
    );

    const duplicateUsername = await requestJson(
      "/api/auth/register",
      jsonRequest({
        email: duplicateUsernameEmail,
        username: username.toUpperCase(),
        password: PASSWORD,
      }),
    );
    assert.equal(duplicateUsername.response.status, 409);

    const sessionCountBeforeFailedLogins = await prisma.session.count({
      where: { userId: persistedUser.id },
    });
    const wrongPassword = await requestJson(
      "/api/auth/login",
      jsonRequest({ email: createdEmail, password: "Wrong-Password-2026" }),
    );
    const unknownEmail = await requestJson(
      "/api/auth/login",
      jsonRequest({
        email: `missing-${suffix}@respawn.local`,
        password: "Wrong-Password-2026",
      }),
    );
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(unknownEmail.response.status, 401);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
    assert.equal(
      await prisma.session.count({ where: { userId: persistedUser.id } }),
      sessionCountBeforeFailedLogins,
    );

    const login = await requestJson(
      "/api/auth/login",
      jsonRequest({ email: createdEmail.toUpperCase(), password: PASSWORD }),
    );
    assert.equal(login.response.status, 200);
    const loginBody = login.body as AuthEnvelope;
    assert.notEqual(loginBody.data.token, registrationBody.data.token);
    assert.notEqual(
      loginBody.data.session.id,
      registrationBody.data.session.id,
    );
    assert.equal(
      JSON.stringify(loginBody).toLowerCase().includes("password"),
      false,
    );
    assert.equal(JSON.stringify(loginBody).includes(PASSWORD), false);

    const persistedLoginSession = await prisma.session.findUniqueOrThrow({
      where: { id: loginBody.data.session.id },
    });
    assert.equal(
      persistedLoginSession.tokenHash,
      createHash("sha256").update(loginBody.data.token, "utf8").digest("hex"),
    );

    const sessionBeforeVerification = await prisma.session.update({
      where: { id: loginBody.data.session.id },
      data: { lastUsedAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    const validSession = await requestJson("/api/auth/session", {
      headers: { Authorization: `Bearer ${loginBody.data.token}` },
    });
    assert.equal(validSession.response.status, 200);
    assert.equal(
      (validSession.body as SessionEnvelope).data.user.id,
      persistedUser.id,
    );
    assert.equal(
      JSON.stringify(validSession.body).toLowerCase().includes("password"),
      false,
    );
    const sessionAfterVerification = await prisma.session.findUniqueOrThrow({
      where: { id: loginBody.data.session.id },
    });
    assert.ok(
      sessionAfterVerification.lastUsedAt > sessionBeforeVerification.lastUsedAt,
    );

    const missingBearer = await requestJson("/api/auth/session");
    assert.equal(missingBearer.response.status, 401);
    assert.equal(
      (missingBearer.body as ErrorEnvelope).error.code,
      "INVALID_SESSION",
    );
    assert.match(
      missingBearer.response.headers.get("www-authenticate") ?? "",
      /^Bearer/,
    );

    const tamperedJwt = await requestJson("/api/auth/session", {
      headers: {
        Authorization: `Bearer ${tamperWithJwt(loginBody.data.token)}`,
      },
    });
    assert.equal(tamperedJwt.response.status, 401);

    await prisma.session.update({
      where: { id: registrationBody.data.session.id },
      data: { revokedAt: new Date() },
    });
    const revokedSession = await requestJson("/api/auth/session", {
      headers: { Authorization: `Bearer ${registrationBody.data.token}` },
    });
    assert.equal(revokedSession.response.status, 401);

    await prisma.session.update({
      where: { id: loginBody.data.session.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const databaseExpiredSession = await requestJson("/api/auth/session", {
      headers: { Authorization: `Bearer ${loginBody.data.token}` },
    });
    assert.equal(databaseExpiredSession.response.status, 401);

    const thirdLogin = await requestJson(
      "/api/auth/login",
      jsonRequest({ email: createdEmail, password: PASSWORD }),
    );
    assert.equal(thirdLogin.response.status, 200);
    const thirdLoginBody = thirdLogin.body as AuthEnvelope;
    await prisma.session.delete({
      where: { id: thirdLoginBody.data.session.id },
    });
    const missingDatabaseSession = await requestJson("/api/auth/session", {
      headers: { Authorization: `Bearer ${thirdLoginBody.data.token}` },
    });
    assert.equal(missingDatabaseSession.response.status, 401);

    const expiredJwtSessionId = randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const expiredJwt = jwt.sign(
      {
        sub: persistedUser.id,
        jti: expiredJwtSessionId,
        iss: "respawn-api",
        aud: "respawn-web",
        token_use: "session",
        iat: nowSeconds - 120,
        exp: nowSeconds - 60,
      },
      JWT_SECRET,
      { algorithm: "HS256" },
    );
    await prisma.session.create({
      data: {
        id: expiredJwtSessionId,
        userId: persistedUser.id,
        tokenHash: createHash("sha256")
          .update(expiredJwt, "utf8")
          .digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    const cryptographicallyExpiredSession = await requestJson(
      "/api/auth/session",
      { headers: { Authorization: `Bearer ${expiredJwt}` } },
    );
    assert.equal(cryptographicallyExpiredSession.response.status, 401);
  },
);
