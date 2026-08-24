import { Buffer } from "node:buffer";

import { z } from "zod";

const bcryptCompatiblePassword = z.string().refine(
  (password) => Buffer.byteLength(password, "utf8") <= 72,
  "A senha deve ter no máximo 72 bytes.",
);

export const registerSchema = z
  .object({
    email: z.string().trim().max(320).email(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_.-]+$/),
    displayName: z.string().trim().min(1).max(64).optional(),
    password: bcryptCompatiblePassword
      .min(12)
      .regex(/[a-z]/, "A senha deve conter uma letra minúscula.")
      .regex(/[A-Z]/, "A senha deve conter uma letra maiúscula.")
      .regex(/[0-9]/, "A senha deve conter um número."),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().max(320).email(),
    password: bcryptCompatiblePassword.min(1),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
