import { AccessToken } from "livekit-server-sdk";

import type { ChatService } from "../chat/chat.service.js";

export interface VoiceTokenResult {
  token: string;
  url: string;
  roomName: string;
}

export interface VoiceService {
  createAccessToken(input: {
    channelSlug: string;
    userId: string;
    username: string;
    displayName: string | null;
    sessionExpiresAt: Date;
  }): Promise<VoiceTokenResult>;
}

interface VoiceServiceOptions {
  apiKey: string;
  apiSecret: string;
  url: string;
  chatService: ChatService;
  /** Segundos de validade do token de conexão — no máximo 10 minutos por padrão. */
  tokenTtlSeconds?: number;
}

// Um nome de sala por canal, isolado do room name que o chat usa para as
// salas do Socket.IO — mesmo slug, propósito diferente, sem risco de colisão
// mesmo se algum dia coexistirem no mesmo namespace de nomes.
function roomNameFor(channelSlug: string): string {
  return `voice:${channelSlug}`;
}

export function createVoiceService(options: VoiceServiceOptions): VoiceService {
  const tokenTtlSeconds = options.tokenTtlSeconds ?? 10 * 60;

  return {
    async createAccessToken(input) {
      // Garante que o canal existe e é do tipo VOICE antes de emitir
      // qualquer token — um token para um canal de texto (ou inexistente)
      // nunca deve sair do servidor.
      await options.chatService.assertVoiceChannel(input.channelSlug, input.userId);

      const roomName = roomNameFor(input.channelSlug);
      // A expiração do token LiveKit controla a conexão inicial. Tokens curtos
      // reduzem a janela de replay no servidor self-hosted e nunca podem
      // sobreviver à sessão Respawn que autorizou sua emissão.
      const remainingSessionSeconds = Math.max(
        1,
        Math.floor((input.sessionExpiresAt.getTime() - Date.now()) / 1_000),
      );
      const accessToken = new AccessToken(options.apiKey, options.apiSecret, {
        identity: input.userId,
        name: input.displayName ?? input.username,
        ttl: Math.min(tokenTtlSeconds, remainingSessionSeconds),
      });

      accessToken.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await accessToken.toJwt();

      return { token, url: options.url, roomName };
    },
  };
}
