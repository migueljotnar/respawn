import { EventEmitter } from "node:events";

import { prisma } from "@respawn/database";

import { createApp } from "./app.js";
import { readApiConfig } from "./config/env.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { attachChatGateway } from "./modules/chat/chat.gateway.js";
import { createChatService } from "./modules/chat/chat.service.js";

const config = readApiConfig();

// Uma única instância, compartilhada entre a API REST e o gateway de
// WebSocket: quando /api/auth/logout revoga uma sessão, o gateway (que
// assina o mesmo emitter) derruba na hora qualquer socket daquela sessão.
const sessionEvents = new EventEmitter();

const app = createApp({
  jwtSecret: config.jwtSecret,
  jwtTtlSeconds: config.jwtTtlSeconds,
  corsOrigin: config.corsOrigin,
  sessionEvents,
  livekit: {
    apiKey: config.livekitApiKey,
    apiSecret: config.livekitApiSecret,
    url: config.livekitUrl,
  },
});
const server = app.listen(config.port, config.host, () => {
  console.info(`Respawn API disponível em http://${config.host}:${config.port}`);
});

const io = attachChatGateway(server, {
  corsOrigin: config.corsOrigin,
  authService: createAuthService({
    jwtSecret: config.jwtSecret,
    jwtTtlSeconds: config.jwtTtlSeconds,
  }),
  chatService: createChatService(),
  sessionEvents,
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info(`Encerrando Respawn API após ${signal}.`);

  // io.close() já fecha o http.Server subjacente (foi passado a ele na
  // criação) — chamar server.close() de novo depois cai em
  // ERR_SERVER_NOT_RUNNING e derruba o exit code para 1 mesmo num shutdown
  // normal. Uma única autoridade fecha tudo, nesta ordem: sockets → prisma.
  io.close((error) => {
    void prisma.$disconnect().then(() => {
      process.exitCode = error ? 1 : 0;
    });
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
