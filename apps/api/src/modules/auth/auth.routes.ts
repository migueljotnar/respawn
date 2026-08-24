import { Router, type Response } from "express";
import { z, type ZodType } from "zod";

import { ApiError } from "../../shared/api-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";

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

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post(
    "/register",
    asyncHandler(async (request, response) => {
      const payload = parsePayload(registerSchema, request.body);
      const result = await authService.register(payload);

      response.status(201).json({ data: result });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (request, response) => {
      const payload = parsePayload(loginSchema, request.body);
      const result = await authService.login(payload);

      response.status(200).json({ data: result });
    }),
  );

  router.get(
    "/session",
    asyncHandler(async (request, response) => {
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

      response.status(200).json({ data: session });
    }),
  );

  return router;
}
