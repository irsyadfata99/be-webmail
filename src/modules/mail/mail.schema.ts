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
