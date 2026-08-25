import { z } from "zod";

function websocketProtocol(value: string): "ws:" | "wss:" | null {
  try {
    const url = new URL(value);

    if (!url.hostname || (url.protocol !== "ws:" && url.protocol !== "wss:")) {
      return null;
    }

    return url.protocol;
  } catch {
    return null;
  }
}

const livekitUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => websocketProtocol(value) !== null, {
    message: "Use uma URL WebSocket ws:// ou wss:// válida.",
  });

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  CORS_ORIGIN: z.url().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 30)
    .default(60 * 60 * 24 * 7),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32),
  LIVEKIT_URL: livekitUrlSchema.default("ws://127.0.0.1:7880"),
}).superRefine((environment, context) => {
  if (
    environment.NODE_ENV === "production" &&
    websocketProtocol(environment.LIVEKIT_URL) !== "wss:"
  ) {
    context.addIssue({
      code: "custom",
      path: ["LIVEKIT_URL"],
      message: "Em produção, LIVEKIT_URL deve usar wss:// e ser configurada explicitamente.",
    });
  }
});

export interface ApiConfig {
  host: string;
  port: number;
  corsOrigin: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitUrl: string;
}

export function readApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const result = apiEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const invalidKeys = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");

    throw new Error(`Configuração inválida da API: ${invalidKeys}`);
  }

  return {
    host: result.data.API_HOST,
    port: result.data.API_PORT,
    corsOrigin: result.data.CORS_ORIGIN,
    jwtSecret: result.data.JWT_SECRET,
    jwtTtlSeconds: result.data.JWT_TTL_SECONDS,
    livekitApiKey: result.data.LIVEKIT_API_KEY,
    livekitApiSecret: result.data.LIVEKIT_API_SECRET,
    livekitUrl: result.data.LIVEKIT_URL,
  };
}
