import type { ErrorRequestHandler, RequestHandler } from "express";

import { ApiError } from "./api-error.js";

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Rota não encontrada.",
    },
  });
};

function isInvalidJsonError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { fields: error.details }),
      },
    });
    return;
  }

  if (isInvalidJsonError(error)) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "O corpo da requisição contém JSON inválido.",
      },
    });
    return;
  }

  if (isPayloadTooLargeError(error)) {
    response.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "O corpo da requisição excede o limite permitido.",
      },
    });
    return;
  }

  console.error(
    "Erro interno não tratado na API:",
    error instanceof Error ? error.name : "UnknownError",
  );

  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Não foi possível concluir a solicitação.",
    },
  });
};
