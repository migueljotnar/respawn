import { prisma } from "@respawn/database";

import { createApp } from "./app.js";
import { readApiConfig } from "./config/env.js";

const config = readApiConfig();
const app = createApp({
  jwtSecret: config.jwtSecret,
  jwtTtlSeconds: config.jwtTtlSeconds,
  corsOrigin: config.corsOrigin,
});
const server = app.listen(config.port, config.host, () => {
  console.info(`Respawn API disponível em http://${config.host}:${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info(`Encerrando Respawn API após ${signal}.`);

  server.close(async (error) => {
    await prisma.$disconnect();
    process.exitCode = error ? 1 : 0;
  });

  setTimeout(() => {
    process.exitCode = 1;
    server.closeAllConnections();
  }, 10_000).unref();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
