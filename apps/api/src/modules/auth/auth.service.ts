import { createHash, randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";

import { prisma, type User } from "@respawn/database";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { ApiError } from "../../shared/api-error.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";
import {
  beginSessionRevocation,
  cancelSessionRevocation,
  markSessionRevoked,
  SESSION_REVOKED_EVENT,
  withSessionLock,
} from "./session-events.js";

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH =
  "$2b$12$9UL2yOX6M/9CInUlnFVqwu2mmK3WeF9F/uRzt1aIy6f.9n1LQsINK";
const JWT_ISSUER = "respawn-api";
const JWT_AUDIENCE = "respawn-web";

const sessionPayloadSchema = z.object({
  sub: z.uuid(),
  jti: z.uuid(),
  iss: z.literal(JWT_ISSUER),
  aud: z.literal(JWT_AUDIENCE),
  token_use: z.literal("session"),
  iat: z.number().int(),
  exp: z.number().int(),
});

type PublicUserSource = Pick<
  User,
  | "id"
  | "email"
  | "username"
  | "displayName"
  | "avatarUrl"
  | "createdAt"
>;

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  session: {
    id: string;
    expiresAt: Date;
  };
  token: string;
  tokenType: "Bearer";
}

export interface VerifiedSession {
  user: PublicUser;
  session: {
    id: string;
    expiresAt: Date;
  };
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  verifySession(token: string): Promise<VerifiedSession | null>;
  /**
   * Revoga a sessão dona do token (idempotente — token desconhecido ou já
   * revogado não é erro). Emite SESSION_REVOKED_EVENT em sessionEvents para
   * que o gateway de WebSocket derrube imediatamente qualquer socket
   * conectado com essa sessão, em vez de esperar a próxima ação ou a
   * expiração natural do token.
   */
  logout(token: string): Promise<void>;
}

interface AuthServiceOptions {
  jwtSecret: string;
  jwtTtlSeconds: number;
  sessionEvents?: EventEmitter;
}

interface SignedSession {
  id: string;
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

const publicUserSelection = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
} as const;

function toPublicUser(user: PublicUserSource): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export function createAuthService(options: AuthServiceOptions): AuthService {
  function signSession(userId: string): SignedSession {
    const id = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAtSeconds = issuedAt + options.jwtTtlSeconds;
    const token = jwt.sign(
      {
        sub: userId,
        jti: id,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        token_use: "session",
        iat: issuedAt,
        exp: expiresAtSeconds,
      },
      options.jwtSecret,
      { algorithm: "HS256" },
    );

    return {
      id,
      token,
      tokenHash: hashToken(token),
      expiresAt: new Date(expiresAtSeconds * 1_000),
    };
  }

  return {
    async register(input) {
      const email = input.email.toLowerCase();
      const username = input.username.toLowerCase();
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      try {
        return await prisma.$transaction(async (transaction) => {
          const user = await transaction.user.create({
            data: {
              email,
              username,
              displayName: input.displayName ?? null,
              passwordHash,
            },
            select: publicUserSelection,
          });
          const session = signSession(user.id);

          await transaction.session.create({
            data: {
              id: session.id,
              tokenHash: session.tokenHash,
              userId: user.id,
              expiresAt: session.expiresAt,
            },
          });

          return {
            user: toPublicUser(user),
            session: {
              id: session.id,
              expiresAt: session.expiresAt,
            },
            token: session.token,
            tokenType: "Bearer" as const,
          };
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ApiError(
            409,
            "ACCOUNT_CONFLICT",
            "Não foi possível criar a conta com esses dados.",
          );
        }

        throw error;
      }
    },

    async login(input) {
      const email = input.email.toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          ...publicUserSelection,
          passwordHash: true,
        },
      });
      const passwordMatches = await bcrypt.compare(
        input.password,
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );

      if (!user || !user.passwordHash || !passwordMatches) {
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Email ou senha inválidos.",
        );
      }

      const session = signSession(user.id);

      await prisma.session.create({
        data: {
          id: session.id,
          tokenHash: session.tokenHash,
          userId: user.id,
          expiresAt: session.expiresAt,
        },
      });

      return {
        user: toPublicUser(user),
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
        },
        token: session.token,
        tokenType: "Bearer",
      };
    },

    async verifySession(token) {
      let payload: z.infer<typeof sessionPayloadSchema>;

      try {
        const verifiedToken = jwt.verify(token, options.jwtSecret, {
          algorithms: ["HS256"],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        });
        const result = sessionPayloadSchema.safeParse(verifiedToken);

        if (!result.success) {
          return null;
        }

        payload = result.data;
      } catch {
        return null;
      }

      const now = new Date();
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          user: {
            select: publicUserSelection,
          },
        },
      });

      if (
        !session ||
        session.id !== payload.jti ||
        session.userId !== payload.sub ||
        session.revokedAt !== null ||
        session.expiresAt <= now
      ) {
        return null;
      }

      const touchedSession = await prisma.session.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { lastUsedAt: now },
      });

      if (touchedSession.count !== 1) {
        return null;
      }

      return {
        user: toPublicUser(session.user),
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
        },
      };
    },

    async logout(token) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { id: true },
      });

      if (!session) {
        return;
      }

      const revoke = async () => {
        // updateMany mantém logout idempotente e evita que duas chamadas
        // concorrentes disputem um update de uma linha já removida/revogada.
        await prisma.session.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        if (options.sessionEvents) {
          // A tombstone é gravada ainda sob o lock. Assim, quando o lock for
          // liberado, qualquer ação enfileirada já observa a revogação mesmo
          // antes de o listener síncrono desconectar os sockets.
          markSessionRevoked(options.sessionEvents, session.id);
        }
      };

      if (options.sessionEvents) {
        // Pending é marcado antes de esperar a fila: somente a operação que
        // já detém o lock pode terminar; nenhuma ação nova/aguardando inicia
        // queries ou inserts enquanto o logout espera sua vez.
        beginSessionRevocation(options.sessionEvents, session.id);

        try {
          await withSessionLock(options.sessionEvents, session.id, revoke);
        } catch (error) {
          cancelSessionRevocation(options.sessionEvents, session.id);
          throw error;
        }

        // Emitir após sair do lock evita reentrância no listener do gateway.
        // A tombstone acima já fechou a janela entre unlock e este emit.
        options.sessionEvents.emit(SESSION_REVOKED_EVENT, { sessionId: session.id });
      } else {
        await revoke();
      }
    },
  };
}
