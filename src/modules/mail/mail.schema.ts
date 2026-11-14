import { z } from "zod";
import { MAX_OUTGOING_FILES } from "./mail.attachment.js";
import { MAX_RECIPIENTS } from "./mail.compose.js";

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

const noLineBreaks = (value: string) => !/[\r\n]/.test(value);

const recipient = z.string().trim().toLowerCase().max(254).pipe(z.email());

const messageIdRef = z
  .string()
  .trim()
  .max(998)
  .regex(/^<[^\s<>]+>$/, "format Message-ID tidak valid");

/** Pesan asal balasan/terusan. */
export const originalRef = z.object({
  folder: listMessagesQuery.shape.folder,
  uid: messageParams.shape.uid,
  kind: z.enum(["reply", "forward"]),
});

/** Indeks lampiran di dalam pesan draf yang dipertahankan (urutan sama dengan GET /drafts/:uid). */
const keepIndexes = z
  .array(z.number().int().min(0).max(999))
  .max(MAX_OUTGOING_FILES)
  .default([]);

export const sendDraftRef = z.object({
  uid: messageParams.shape.uid,
  keepAttachments: keepIndexes,
});

export const sendBody = z
  .object({
    to: z.array(recipient).min(1).max(50),
    cc: z.array(recipient).max(50).default([]),
    bcc: z.array(recipient).max(50).default([]),
    subject: z
      .string()
      .trim()
      .max(255)
      .refine(noLineBreaks, "subjek tidak boleh berisi baris baru")
      .default(""),
    text: z.string().max(500_000).optional(),
    html: z.string().max(1_000_000).optional(),
    inReplyTo: messageIdRef.optional(),
    references: z.array(messageIdRef).max(50).default([]),
    // Pesan asal balasan/terusan; dipakai menandai \\Answered atau $Forwarded setelah terkirim.
    original: originalRef.optional(),
    forwardAttachments: z.boolean().default(false),
    // Kirim dari draf tersimpan: lampiran draf yang dipertahankan ikut terkirim, lalu draf dihapus.
    draft: sendDraftRef.optional(),
  })
  .refine((b) => !b.forwardAttachments || b.original?.kind === "forward", {
    message: "forwardAttachments hanya untuk pesan terusan",
    path: ["forwardAttachments"],
  })
  .refine((b) => Boolean(b.text?.trim() || b.html?.trim()), {
    message: "isi pesan (text atau html) wajib diisi",
    path: ["text"],
  })
  .refine((b) => new Set([...b.to, ...b.cc, ...b.bcc]).size <= MAX_RECIPIENTS, {
    message: `maksimal ${MAX_RECIPIENTS} penerima`,
    path: ["to"],
  });

export type SendBody = z.infer<typeof sendBody>;

export const composeDraftQuery = z.object({
  folder: listMessagesQuery.shape.folder,
  mode: z.enum(["reply", "replyAll", "forward"]),
});

/**
 * Draf boleh belum lengkap: penerima, subjek, dan isi boleh kosong.
 * Alamat yang diisi tetap harus valid.
 */
export const draftBody = z
  .object({
    to: z.array(recipient).max(50).default([]),
    cc: z.array(recipient).max(50).default([]),
    bcc: z.array(recipient).max(50).default([]),
    subject: z
      .string()
      .trim()
      .max(255)
      .refine(noLineBreaks, "subjek tidak boleh berisi baris baru")
      .default(""),
    text: z.string().max(500_000).optional(),
    html: z.string().max(1_000_000).optional(),
    inReplyTo: messageIdRef.optional(),
    references: z.array(messageIdRef).max(50).default([]),
    original: originalRef.optional(),
    // Hanya dipakai pada simpan pertama; setelah itu lampiran sudah ada di dalam draf.
    forwardAttachments: z.boolean().default(false),
    // UID draf sebelumnya yang diganti oleh versi baru ini.
    replaceUid: messageParams.shape.uid.optional(),
    keepAttachments: keepIndexes,
  })
  .refine((b) => !b.forwardAttachments || b.original?.kind === "forward", {
    message: "forwardAttachments hanya untuk pesan terusan",
    path: ["forwardAttachments"],
  })
  .refine((b) => new Set([...b.to, ...b.cc, ...b.bcc]).size <= MAX_RECIPIENTS, {
    message: `maksimal ${MAX_RECIPIENTS} penerima`,
    path: ["to"],
  })
  .refine((b) => b.keepAttachments.length === 0 || b.replaceUid !== undefined, {
    message: "keepAttachments memerlukan replaceUid",
    path: ["keepAttachments"],
  });

export type DraftBody = z.infer<typeof draftBody>;

// ---- Modul Kelola ----

const folderPath = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(noControlChars, "nama folder tidak valid");

/** Aksi massal dibatasi 100 pesan per permintaan; UID kembar digabung. */
const uidList = z
  .array(messageParams.shape.uid)
  .min(1)
  .max(100)
  .transform((uids) => [...new Set(uids)]);

export const FLAG_NAMES = ["seen", "flagged"] as const;
export type FlagName = (typeof FLAG_NAMES)[number];
const flagName = z.enum(FLAG_NAMES);

export const flagsBody = z
  .object({
    folder: folderPath,
    uids: uidList,
    add: z.array(flagName).max(2).default([]),
    remove: z.array(flagName).max(2).default([]),
  })
  .refine((b) => b.add.length + b.remove.length > 0, {
    message: "isi add atau remove",
    path: ["add"],
  })
  .refine((b) => !b.add.some((f) => b.remove.includes(f)), {
    message: "flag yang sama tidak boleh ada di add dan remove",
    path: ["remove"],
  });

export type FlagsBody = z.infer<typeof flagsBody>;

export const TARGET_ROLES = ["inbox", "spam", "trash", "archive"] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

export const moveBody = z
  .object({
    folder: folderPath,
    uids: uidList,
    to: folderPath.optional(),
    toRole: z.enum(TARGET_ROLES).optional(),
  })
  .refine((b) => (b.to === undefined) !== (b.toRole === undefined), {
    message: "isi salah satu: to atau toRole",
    path: ["to"],
  });

export type MoveBody = z.infer<typeof moveBody>;

export const deleteBody = z.object({ folder: folderPath, uids: uidList });

export const emptyFolderBody = z.object({ folder: folderPath });

export const searchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(noControlChars, "kata kunci tidak valid"),
  folder: listMessagesQuery.shape.folder,
  scope: z.enum(["folder", "all"]).default("folder"),
  page: listMessagesQuery.shape.page,
  pageSize: listMessagesQuery.shape.pageSize,
});

export const threadQuery = z.object({ folder: listMessagesQuery.shape.folder });
