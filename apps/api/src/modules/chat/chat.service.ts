import { ChannelType, prisma, Role } from "@respawn/database";

import { ApiError } from "../../shared/api-error.js";

const DEFAULT_SERVER_NAME = "Respawn HQ";

const DEFAULT_CHANNELS: ReadonlyArray<{
  name: string;
  type: ChannelType;
  position: number;
}> = [
  { name: "spawn-point", type: ChannelType.TEXT, position: 0 },
  { name: "chat-geral", type: ChannelType.TEXT, position: 1 },
  { name: "party-up", type: ChannelType.TEXT, position: 2 },
  { name: "clips-e-highlights", type: ChannelType.TEXT, position: 3 },
  { name: "lobby-neon", type: ChannelType.VOICE, position: 4 },
  { name: "squad-alpha", type: ChannelType.VOICE, position: 5 },
];

export interface ChatAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
}

export interface ChatMessage {
  id: string;
  channelSlug: string;
  content: string;
  createdAt: string;
  author: ChatAuthor;
}

export interface CreateMessageResult {
  message: ChatMessage;
  /** true somente para a chamada que efetivamente inseriu a linha. */
  created: boolean;
}

export interface ChatMember {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
}

export interface ListMessagesOptions {
  limit: number;
  before?: { createdAt: Date; id: string };
  after?: { createdAt: Date; id: string };
}

export interface ChatChannel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
}

export interface ChatService {
  ensureMembership(userId: string): Promise<{ serverId: string; role: Role }>;
  /**
   * Resolve o canal pelo slug e garante que é do tipo TEXT — usado antes de
   * channel:join, typing:start/stop e message:send. Lança ApiError
   * (CHANNEL_NOT_FOUND / CHANNEL_NOT_TEXT) quando a ação não é permitida.
   */
  assertTextChannel(
    channelSlug: string,
    requestingUserId: string,
  ): Promise<{ channel: ChatChannel; role: Role }>;
  /**
   * Espelho de assertTextChannel para o módulo de voz: resolve o canal e
   * garante que é do tipo VOICE. Usado antes de emitir um token de acesso
   * LiveKit — um canal de texto não pode virar sala de voz.
   */
  assertVoiceChannel(
    channelSlug: string,
    requestingUserId: string,
  ): Promise<{ channel: ChatChannel; role: Role }>;
  listMessages(
    channelSlug: string,
    requestingUserId: string,
    options: ListMessagesOptions,
  ): Promise<ChatMessage[]>;
  createMessage(input: {
    channelSlug: string;
    authorId: string;
    content: string;
    clientMessageId?: string;
  }): Promise<CreateMessageResult>;
  listMembers(requestingUserId: string): Promise<ChatMember[]>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

// Compartilhado entre as instâncias criadas para o Express (app.ts) e para o
// gateway de WebSocket (server.ts) — ambas rodam no mesmo processo Node e
// importam este módulo uma única vez. É só uma otimização para evitar round
// trips repetidos; a correção sob concorrência (inclusive entre processos
// diferentes) vem das constraints únicas em `servers.name` e
// `channels(server_id, name)`, não deste cache.
let cachedServerId: string | null = null;

async function ensureDefaultServer(creatorUserId: string): Promise<string> {
  if (cachedServerId) {
    return cachedServerId;
  }

  let server: { id: string };

  try {
    server = await prisma.server.create({
      data: { name: DEFAULT_SERVER_NAME, ownerId: creatorUserId },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    // Outra chamada concorrente venceu a corrida de criação do servidor
    // padrão; o índice único em `name` garante que só existe um vencedor.
    server = await prisma.server.findUniqueOrThrow({
      where: { name: DEFAULT_SERVER_NAME },
      select: { id: true },
    });
  }

  await Promise.all(
    DEFAULT_CHANNELS.map(async (definition) => {
      try {
        await prisma.channel.create({
          data: {
            serverId: server.id,
            name: definition.name,
            type: definition.type,
            position: definition.position,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        // Idem: outra chamada concorrente já criou este canal.
      }
    }),
  );

  cachedServerId = server.id;
  return server.id;
}

async function resolveChannel(
  channelSlug: string,
  requestingUserId: string,
): Promise<ChatChannel> {
  const serverId = await ensureDefaultServer(requestingUserId);
  const channel = await prisma.channel.findFirst({
    where: { serverId, name: channelSlug },
    select: { id: true, serverId: true, name: true, type: true },
  });

  if (!channel) {
    throw new ApiError(404, "CHANNEL_NOT_FOUND", "Canal não encontrado.");
  }

  return channel;
}

async function assertTextChannel(
  channelSlug: string,
  requestingUserId: string,
): Promise<{ channel: ChatChannel; role: Role }> {
  const { role } = await ensureMembership(requestingUserId);
  const channel = await resolveChannel(channelSlug, requestingUserId);

  if (channel.type !== ChannelType.TEXT) {
    throw new ApiError(
      403,
      "CHANNEL_NOT_TEXT",
      "Canais de voz não aceitam mensagens ou indicador de digitação.",
    );
  }

  return { channel, role };
}

async function assertVoiceChannel(
  channelSlug: string,
  requestingUserId: string,
): Promise<{ channel: ChatChannel; role: Role }> {
  const { role } = await ensureMembership(requestingUserId);
  const channel = await resolveChannel(channelSlug, requestingUserId);

  if (channel.type !== ChannelType.VOICE) {
    throw new ApiError(
      403,
      "CHANNEL_NOT_VOICE",
      "Este canal não é uma sala de voz.",
    );
  }

  return { channel, role };
}

function toAuthor(
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  },
  role: Role,
): ChatAuthor {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role,
  };
}

async function ensureMembership(
  userId: string,
): Promise<{ serverId: string; role: Role }> {
  const serverId = await ensureDefaultServer(userId);

  try {
    const membership = await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId, userId } },
      create: { serverId, userId },
      update: {},
      select: { role: true },
    });

    return { serverId, role: membership.role };
  } catch (error) {
    // Duas conexões quase simultâneas do mesmo usuário podem disparar o
    // upsert em paralelo; a segunda perde a corrida no índice único e cai
    // aqui — nesse caso a membership já existe, então só a lemos de volta.
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId } },
      select: { role: true },
    });

    return { serverId, role: existing.role };
  }
}

const messageSelection = {
  id: true,
  channelId: true,
  content: true,
  createdAt: true,
  channel: {
    select: { name: true },
  },
  author: {
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  },
} as const;

type SelectedMessage = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  channel: { name: string };
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

function toChatMessage(row: SelectedMessage, role: Role): ChatMessage {
  return {
    id: row.id,
    // Nunca derive o canal do novo input em um retry: a fonte da verdade é
    // a linha persistida. Isso impede DTO/broadcast fantasma em outro canal.
    channelSlug: row.channel.name,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    author: toAuthor(row.author, role),
  };
}

function assertIdempotentRetryMatches(
  row: Pick<SelectedMessage, "channelId" | "content">,
  input: { channelId: string; content: string },
): void {
  if (row.channelId !== input.channelId || row.content !== input.content) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "clientMessageId já foi usado com outro canal ou conteúdo.",
    );
  }
}

async function createMessage(input: {
  channelSlug: string;
  authorId: string;
  content: string;
  clientMessageId?: string;
}): Promise<CreateMessageResult> {
  const { channel, role } = await assertTextChannel(input.channelSlug, input.authorId);
  const clientMessageId = input.clientMessageId ?? null;

  if (clientMessageId) {
    // Reenvio idempotente: se este autor já persistiu uma mensagem com este
    // clientMessageId (ex.: o ACK original se perdeu e o cliente tentou de
    // novo com o mesmo id), devolve a mensagem já existente em vez de criar
    // uma segunda.
    const existing = await prisma.message.findUnique({
      where: { authorId_clientMessageId: { authorId: input.authorId, clientMessageId } },
      select: messageSelection,
    });

    if (existing) {
      assertIdempotentRetryMatches(existing, {
        channelId: channel.id,
        content: input.content,
      });
      return { message: toChatMessage(existing, role), created: false };
    }
  }

  try {
    const created = await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: input.authorId,
        content: input.content,
        clientMessageId,
      },
      select: messageSelection,
    });

    return { message: toChatMessage(created, role), created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error) || !clientMessageId) {
      throw error;
    }

    // Corrida: duas chamadas com o mesmo clientMessageId chegaram quase
    // juntas (ex.: reenvio automático) e a checagem acima não viu a outra
    // ainda. O índice único garante que só uma foi persistida; buscamos essa.
    const winner = await prisma.message.findUniqueOrThrow({
      where: { authorId_clientMessageId: { authorId: input.authorId, clientMessageId } },
      select: messageSelection,
    });

    assertIdempotentRetryMatches(winner, {
      channelId: channel.id,
      content: input.content,
    });
    return { message: toChatMessage(winner, role), created: false };
  }
}

async function listMessages(
  channelSlug: string,
  requestingUserId: string,
  options: ListMessagesOptions,
): Promise<ChatMessage[]> {
  await ensureMembership(requestingUserId);
  const channel = await resolveChannel(channelSlug, requestingUserId);

  const cursorFilter = options.before
    ? {
        OR: [
          { createdAt: { lt: options.before.createdAt } },
          { createdAt: options.before.createdAt, id: { lt: options.before.id } },
        ],
      }
    : options.after
      ? {
          OR: [
            { createdAt: { gt: options.after.createdAt } },
            { createdAt: options.after.createdAt, id: { gt: options.after.id } },
          ],
        }
      : {};

  const rows = await prisma.message.findMany({
    where: { channelId: channel.id, ...cursorFilter },
    orderBy: options.after
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit,
    select: messageSelection,
  });

  // A busca "after" (resync pós-reconexão) já vem em ordem cronológica; a
  // busca "before"/inicial vem do banco em ordem decrescente e precisa ser
  // revertida para ficar cronológica também.
  const orderedRows = options.after ? rows : rows.reverse();
  const roleByAuthor = new Map<string, Role>();
  const results: ChatMessage[] = [];

  for (const row of orderedRows) {
    let role = roleByAuthor.get(row.author.id);

    if (!role) {
      const membership = await prisma.serverMember.findUnique({
        where: {
          serverId_userId: { serverId: channel.serverId, userId: row.author.id },
        },
        select: { role: true },
      });
      role = membership?.role ?? Role.NOVATO;
      roleByAuthor.set(row.author.id, role);
    }

    results.push({
      id: row.id,
      channelSlug,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      author: toAuthor(row.author, role),
    });
  }

  return results;
}

async function listMembers(requestingUserId: string): Promise<ChatMember[]> {
  const { serverId } = await ensureMembership(requestingUserId);

  const rows = await prisma.serverMember.findMany({
    where: { serverId },
    orderBy: { joinedAt: "asc" },
    select: {
      role: true,
      user: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
    },
  });

  return rows.map((row) => ({ ...row.user, role: row.role }));
}

export function createChatService(): ChatService {
  return {
    ensureMembership,
    assertTextChannel,
    assertVoiceChannel,
    listMessages,
    createMessage,
    listMembers,
  };
}
