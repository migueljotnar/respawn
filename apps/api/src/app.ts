import { Buffer } from "node:buffer";

import cors from "cors";
import express, { type Express } from "express";

import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { errorHandler, notFoundHandler } from "./shared/http-errors.js";

export interface CreateAppOptions {
  jwtSecret: string;
  jwtTtlSeconds?: number;
  corsOrigin?: string;
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
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
