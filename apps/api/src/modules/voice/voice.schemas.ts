import { z } from "zod";

import { channelSlugSchema } from "../chat/chat.schemas.js";

export const voiceTokenRequestSchema = z
  .object({
    channelSlug: channelSlugSchema,
  })
  .strict();

export type VoiceTokenRequest = z.infer<typeof voiceTokenRequestSchema>;
