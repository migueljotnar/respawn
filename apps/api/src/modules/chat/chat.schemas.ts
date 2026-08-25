import { z } from "zod";

export const channelSlugSchema = z.string().trim().min(1).max(64);

export const sendMessageSchema = z
  .object({
    channelSlug: channelSlugSchema,
    content: z.string().trim().min(1).max(2000),
    clientMessageId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const joinChannelSchema = z
  .object({
    channelSlug: channelSlugSchema,
  })
  .strict();

export const typingSchema = z
  .object({
    channelSlug: channelSlugSchema,
  })
  .strict();

export const historyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    beforeCreatedAt: z.string().trim().min(1).optional(),
    beforeId: z.uuid().optional(),
    afterCreatedAt: z.string().trim().min(1).optional(),
    afterId: z.uuid().optional(),
  })
  .refine(
    (value) => (value.beforeCreatedAt === undefined) === (value.beforeId === undefined),
    { message: "beforeCreatedAt e beforeId devem ser enviados juntos." },
  )
  .refine(
    (value) => (value.afterCreatedAt === undefined) === (value.afterId === undefined),
    { message: "afterCreatedAt e afterId devem ser enviados juntos." },
  )
  .refine(
    (value) => value.beforeCreatedAt === undefined || value.afterCreatedAt === undefined,
    { message: "Use before ou after, não os dois ao mesmo tempo." },
  );

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type JoinChannelInput = z.infer<typeof joinChannelSchema>;
export type TypingInput = z.infer<typeof typingSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
