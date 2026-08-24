import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

const localDatabaseUrl =
  "postgresql://respawn:respawn_local_password@127.0.0.1:5432/respawn?schema=public";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL é obrigatória em produção.");
  }

  return localDatabaseUrl;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: resolveDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
  });

  return new PrismaClient({ adapter });
}

const globalDatabase = globalThis as typeof globalThis & {
  respawnPrisma?: PrismaClient;
};

export const prisma = globalDatabase.respawnPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.respawnPrisma = prisma;
}
