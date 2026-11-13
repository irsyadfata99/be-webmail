import { z } from "zod";

const noControlChars = (value: string) =>
  ![...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127;
  });

export const listMessagesQuery = z.object({
  folder: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(noControlChars, "nama folder tidak valid")
    .default("INBOX"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

const flag = z
  .enum(["1", "true", "0", "false"])
  .optional()
  .transform((v) => v === "1" || v === "true");

export const messageParams = z.object({
  uid: z.coerce.number().int().min(1).max(4_294_967_295),
});

export const getMessageQuery = z.object({
  folder: listMessagesQuery.shape.folder,
  images: flag,
  markSeen: flag,
});

export type GetMessageQuery = z.infer<typeof getMessageQuery>;

export const attachmentParams = z.object({
  uid: messageParams.shape.uid,
  index: z.coerce.number().int().min(0).max(999),
});

export const attachmentQuery = z.object({
  folder: listMessagesQuery.shape.folder,
  inline: flag,
});
