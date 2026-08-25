import { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";

import cors from "cors";
import express, { type Express } from "express";

import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { createChatRouter } from "./modules/chat/chat.routes.js";
import { createChatService } from "./modules/chat/chat.service.js";
import { createVoiceRouter } from "./modules/voice/voice.routes.js";
import { createVoiceService } from "./modules/voice/voice.service.js";
import { errorHandler, notFoundHandler } from "./shared/http-errors.js";

export interface CreateAppOptions {
  jwtSecret: string;
  jwtTtlSeconds?: number;
  corsOrigin?: string;
  /**
   * Compartilhado com attachChatGateway (mesma instância) para que um
   * logout/revogação via REST derrube na hora os sockets ligados àquela
   * sessão. Opcional só para não quebrar quem construía CreateAppOptions
   * sem isso antes desta mudança — em server.ts sempre passamos um.
   */
  sessionEvents?: EventEmitter;
  livekit: {
    apiKey: string;
    apiSecret: string;
    url: string;
  };
}

export function createApp(options: CreateAppOptions): Express {
  if (Buffer.byteLength(options.jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET deve possuir pelo menos 32 bytes.");
  }

  const jwtTtlSeconds = options.jwtTtlSeconds ?? 60 * 60 * 24 * 7;

  if (
    !Number.isInteger(jwtTtlSeconds) ||
    jwtTtlSeconds < 60 ||
    jwtTtlSeconds > 60 * 60 * 24 * 30
  ) {
    throw new Error("JWT_TTL_SECONDS deve estar entre 60 e 2592000.");
  }

  const app = express();
  const authService = createAuthService({
    jwtSecret: options.jwtSecret,
    jwtTtlSeconds,
    ...(options.sessionEvents === undefined ? {} : { sessionEvents: options.sessionEvents }),
  });
  const chatService = createChatService();
  const voiceService = createVoiceService({
    apiKey: options.livekit.apiKey,
    apiSecret: options.livekit.apiSecret,
    url: options.livekit.url,
    chatService,
  });

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(
    cors({
      origin: options.corsOrigin ?? "http://localhost:5173",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  app.use("/api/auth", createAuthRouter(authService));
  app.use("/api/chat", createChatRouter(authService, chatService));
  app.use(
    "/api/voice",
    createVoiceRouter(authService, voiceService, options.sessionEvents),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
