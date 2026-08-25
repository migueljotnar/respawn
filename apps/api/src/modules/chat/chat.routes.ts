import { Router, type NextFunction, type Request, type Response } from "express";
import { z, type ZodType } from "zod";

import { ApiError } from "../../shared/api-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import type { AuthService, PublicUser } from "../auth/auth.service.js";
import { historyQuerySchema } from "./chat.schemas.js";
import type { ChatService, ListMessagesOptions } from "./chat.service.js";

interface ChatRequest extends Request {
  chatUser?: PublicUser;
}

function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Revise os parâmetros enviados.",
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

function parseCursor(
  createdAtRaw: string | undefined,
  id: string | undefined,
  fieldLabel: string,
): { createdAt: Date; id: string } | undefined {
  if (createdAtRaw === undefined || id === undefined) {
    return undefined;
  }

  const createdAt = new Date(createdAtRaw);

  if (Number.isNaN(createdAt.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldLabel} inválido.`);
  }

  return { createdAt, id };
}

function requireAuth(authService: AuthService) {
  return asyncHandler(async (request: ChatRequest, response, next: NextFunction) => {
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

    request.chatUser = session.user;
    next();
  });
}

export function createChatRouter(
  authService: AuthService,
  chatService: ChatService,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth(authService));

  router.get(
    "/channels/:slug/messages",
    asyncHandler(async (request: ChatRequest, response) => {
      const query = parseQuery(historyQuerySchema, request.query);
      const before = parseCursor(query.beforeCreatedAt, query.beforeId, "beforeCreatedAt");
      const after = parseCursor(query.afterCreatedAt, query.afterId, "afterCreatedAt");

      const channelSlug = request.params.slug;

      if (typeof channelSlug !== "string") {
        throw new ApiError(400, "VALIDATION_ERROR", "Canal inválido.");
      }

      const options: ListMessagesOptions = {
        limit: query.limit,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      };
      const messages = await chatService.listMessages(
        channelSlug,
        request.chatUser!.id,
        options,
      );

      response.status(200).json({ data: messages });
    }),
  );

  router.get(
    "/members",
    asyncHandler(async (request: ChatRequest, response) => {
      const members = await chatService.listMembers(request.chatUser!.id);
      response.status(200).json({ data: members });
    }),
  );

  return router;
}
