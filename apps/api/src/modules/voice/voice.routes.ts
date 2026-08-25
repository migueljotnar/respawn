import type { EventEmitter } from "node:events";

import { Router, type NextFunction, type Request, type Response } from "express";
import { z, type ZodType } from "zod";

import { ApiError } from "../../shared/api-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import type { AuthService, VerifiedSession } from "../auth/auth.service.js";
import {
  isSessionRevocationPending,
  isSessionRevoked,
  withSessionLock,
} from "../auth/session-events.js";
import { voiceTokenRequestSchema } from "./voice.schemas.js";
import type { VoiceService } from "./voice.service.js";

interface VoiceRequest extends Request {
  voiceSession?: VerifiedSession;
  voiceBearerToken?: string;
}

function parsePayload<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Revise os campos enviados.",
      z.flattenError(result.error).fieldErrors,
    );
  }

  return result.data;
}

function rejectInvalidSession(response: Response): void {
  response.setHeader("WWW-Authenticate", 'Bearer realm="respawn"');
  response.status(401).json({
    error: {
      code: "INVALID_SESSION",
      message: "Sessão inválida ou expirada.",
    },
  });
}

function requireAuth(authService: AuthService) {
  return asyncHandler(async (request: VoiceRequest, response, next: NextFunction) => {
    const authorization = request.get("authorization");
    const bearerToken = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];

    if (!bearerToken) {
      rejectInvalidSession(response);
      return;
    }

    const session = await authService.verifySession(bearerToken);

    if (!session) {
      rejectInvalidSession(response);
      return;
    }

    request.voiceSession = session;
    request.voiceBearerToken = bearerToken;
    next();
  });
}

export function createVoiceRouter(
  authService: AuthService,
  voiceService: VoiceService,
  sessionEvents?: EventEmitter,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth(authService));

  router.post(
    "/token",
    asyncHandler(async (request: VoiceRequest, response) => {
      const payload = parsePayload(voiceTokenRequestSchema, request.body);
      const verifiedSession = request.voiceSession!;
      const bearerToken = request.voiceBearerToken!;

      const issueForCurrentSession = async () => {
        // Revalida sob o lock. Isso fecha a janela entre o middleware e a
        // emissão caso a sessão tenha expirado ou sido revogada nesse intervalo.
        const freshSession = await authService.verifySession(bearerToken);

        if (!freshSession || freshSession.session.id !== verifiedSession.session.id) {
          return null;
        }

        const user = freshSession.user;
        return voiceService.createAccessToken({
          channelSlug: payload.channelSlug,
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          sessionExpiresAt: freshSession.session.expiresAt,
        });
      };

      let result;

      if (sessionEvents) {
        const sessionId = verifiedSession.session.id;

        if (
          isSessionRevoked(sessionEvents, sessionId) ||
          isSessionRevocationPending(sessionEvents, sessionId)
        ) {
          rejectInvalidSession(response);
          return;
        }

        result = await withSessionLock(sessionEvents, sessionId, async () => {
          if (
            isSessionRevoked(sessionEvents, sessionId) ||
            isSessionRevocationPending(sessionEvents, sessionId)
          ) {
            return null;
          }

          return issueForCurrentSession();
        });
      } else {
        result = await issueForCurrentSession();
      }

      if (!result) {
        rejectInvalidSession(response);
        return;
      }

      response.status(200).json({ data: result });
    }),
  );

  return router;
}
