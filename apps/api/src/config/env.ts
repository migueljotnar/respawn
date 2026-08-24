import { z } from "zod";

const apiEnvironmentSchema = z.object({
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
});

export interface ApiConfig {
  host: string;
  port: number;
  corsOrigin: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
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
  };
}
