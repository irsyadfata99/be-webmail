import { type AddressObject, simpleParser } from "mailparser";
import type { SendMailOptions } from "nodemailer";
import { buildMailOptions, type Sender } from "./mail.compose.js";
import { sanitizeEmailHtml } from "./mail.sanitize.js";
import { type DraftBody, originalRef } from "./mail.schema.js";

/**
 * Fungsi murni untuk draf tersimpan (folder Drafts). Tidak menyentuh jaringan.
 * Nama sengaja "saved draft", bukan "draft", agar tidak tertukar dengan
 * prefill balas/teruskan di mail.reply.ts.
 */

export const ORIGINAL_HEADER = "X-Webmail-Original";

export type OriginalRef = ReturnType<typeof originalRef.parse>;

/** Pesan asal disimpan di header agar balas/teruskan tetap tertandai setelah draf dikirim. */
export function encodeOriginal(original: OriginalRef): string {
  return Buffer.from(JSON.stringify(original), "utf8").toString("base64url");
}

export function decodeOriginal(
  value: string | null | undefined,
): OriginalRef | null {
  if (!value) return null;
  try {
    // Header panjang bisa dilipat server; buang semua spasi sebelum didekode.
    const raw = Buffer.from(value.replace(/\s+/g, ""), "base64url").toString(
      "utf8",
    );
    const parsed = originalRef.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Draf yang sama sekali kosong tidak disimpan (seperti Gmail). Lampiran dinilai terpisah. */
export function isEmptyDraft(
  input: Pick<DraftBody, "to" | "cc" | "bcc" | "subject" | "text" | "html">,
): boolean {
  return (
    input.to.length === 0 &&
    input.cc.length === 0 &&
    input.bcc.length === 0 &&
    input.subject.trim() === "" &&
    !input.text?.trim() &&
    !input.html?.trim()
  );
}

/** Opsi pesan untuk draf. Pengirim selalu dari sesi; HTML dibersihkan seperti saat kirim. */
export function buildDraftOptions(
  input: DraftBody,
  sender: Sender,
  mailDomain: string,
  now: Date = new Date(),
): SendMailOptions {
  const options = buildMailOptions(input, sender, mailDomain, now);
  if (input.original) {
    options.headers = { [ORIGINAL_HEADER]: encodeOriginal(input.original) };
  }
  return options;
}

export interface SavedDraftAttachment {
  /** Urutan di dalam pesan draf; dikirim balik sebagai keepAttachments. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface SavedDraftContent {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  original: OriginalRef | null;
  attachments: SavedDraftAttachment[];
}

function addressList(
  field: AddressObject | AddressObject[] | undefined,
): string[] {
  if (!field) return [];
  const objects = Array.isArray(field) ? field : [field];
  return objects
    .flatMap((o) => o.value)
    .map((a) => a.address?.toLowerCase())
    .filter((a): a is string => Boolean(a));
}

function referenceList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(/\s+/).filter(Boolean);
}

/** Mengurai draf mentah menjadi bentuk yang bisa diedit lagi. */
export async function parseSavedDraft(
  source: Buffer,
): Promise<SavedDraftContent> {
  const mail = await simpleParser(source, { skipImageLinks: true });
  const header = mail.headers.get(ORIGINAL_HEADER.toLowerCase());
  return {
    to: addressList(mail.to),
    cc: addressList(mail.cc),
    bcc: addressList(mail.bcc),
    subject: mail.subject ?? "",
    text: mail.text ?? "",
    html:
      typeof mail.html === "string" && mail.html.length > 0
        ? sanitizeEmailHtml(mail.html, true).html
        : null,
    inReplyTo: mail.inReplyTo ?? null,
    references: referenceList(mail.references),
    original: decodeOriginal(typeof header === "string" ? header : null),
    attachments: mail.attachments.map((a, index) => ({
      index,
      filename: a.filename ?? "",
      contentType: a.contentType,
      size: a.size,
    })),
  };
}

export interface PickedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Isi lampiran draf menurut indeks. Null bila ada indeks yang tidak ada. */
export async function pickDraftAttachments(
  source: Buffer,
  indexes: readonly number[],
): Promise<PickedAttachment[] | null> {
  const mail = await simpleParser(source, { skipImageLinks: true });
  const out: PickedAttachment[] = [];
  for (const index of new Set(indexes)) {
    const a = mail.attachments[index];
    if (!a) return null;
    out.push({
      filename: a.filename ?? "",
      contentType: a.contentType,
      content: a.content,
    });
  }
  return out;
}
