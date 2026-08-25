import assert from "node:assert/strict";
import { test } from "node:test";

import { readApiConfig } from "./env.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  JWT_SECRET: "config-test-secret-with-at-least-thirty-two-bytes",
  LIVEKIT_API_KEY: "config-test-key",
  LIVEKIT_API_SECRET: "config-test-livekit-secret-at-least-thirty-two-bytes",
};

test("LIVEKIT_URL aceita somente WebSocket e normaliza espaços", () => {
  const config = readApiConfig({
    ...BASE_ENV,
    LIVEKIT_URL: "  wss://livekit.example.com  ",
  });

  assert.equal(config.livekitUrl, "wss://livekit.example.com");
});

test("LIVEKIT_URL rejeita protocolos que o cliente LiveKit não pode usar", () => {
  for (const invalidUrl of ["not a url", "https://livekit.example.com", "javascript:alert(1)", "   "]) {
    assert.throws(
      () => readApiConfig({ ...BASE_ENV, LIVEKIT_URL: invalidUrl }),
      /LIVEKIT_URL/,
      `deveria rejeitar ${JSON.stringify(invalidUrl)}`,
    );
  }
});

test("produção exige uma URL pública segura wss:// sem fallback localhost", () => {
  assert.throws(
    () => readApiConfig({ ...BASE_ENV, NODE_ENV: "production" }),
    /LIVEKIT_URL/,
  );
  assert.throws(
    () =>
      readApiConfig({
        ...BASE_ENV,
        NODE_ENV: "production",
        LIVEKIT_URL: "ws://livekit.example.com",
      }),
    /LIVEKIT_URL/,
  );

  assert.equal(
    readApiConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      LIVEKIT_URL: "wss://livekit.example.com",
    }).livekitUrl,
    "wss://livekit.example.com",
  );
});

test("desenvolvimento mantém o fallback local explícito", () => {
  assert.equal(readApiConfig(BASE_ENV).livekitUrl, "ws://127.0.0.1:7880");
});
