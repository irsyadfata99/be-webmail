import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { isInlineImageType, normalizeCid } from "./mail.attachment.js";
import { sanitizeEmailHtml } from "./mail.sanitize.js";
import { type MailAddress, toAddresses, toIso } from "./mail.utils.js";

export interface AttachmentInfo {
  /** Urutan di dalam pesan; dipakai tahap unduh lampiran. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  cid: string | null;
}

export interface ParsedMessage {
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  text: string | null;
  html: string | null;
  blockedImages: number;
  attachments: AttachmentInfo[];
}

function addressesOf(
  field: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
  if (!field) return [];
  const objects = Array.isArray(field) ? field : [field];
  return objects.flatMap((o) => toAddresses(o.value));
}

function referencesOf(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(/\s+/).filter(Boolean);
}

/** Membuat URL untuk lampiran ke-`index`; dipakai menulis ulang gambar cid:. */
export type AttachmentUrl = (index: number) => string;

export function toParsedMessage(
  mail: ParsedMail,
  allowImages: boolean,
  attachmentUrl?: AttachmentUrl,
): ParsedMessage {
  const cidIndex = new Map<string, number>();
  mail.attachments.forEach((a, index) => {
    const cid = normalizeCid(a.cid ?? a.contentId);
    if (cid && isInlineImageType(a.contentType)) cidIndex.set(cid, index);
  });

  let html: string | null = null;
  let blockedImages = 0;
  if (typeof mail.html === "string" && mail.html.length > 0) {
    const cleaned = sanitizeEmailHtml(mail.html, allowImages, (cid) => {
      const index = cidIndex.get(normalizeCid(cid));
      return index === undefined || !attachmentUrl
        ? null
        : attachmentUrl(index);
    });
    html = cleaned.html;
    blockedImages = cleaned.blockedImages;
  }

  return {
    subject: mail.subject ?? "",
    from: addressesOf(mail.from),
    to: addressesOf(mail.to),
    cc: addressesOf(mail.cc),
    bcc: addressesOf(mail.bcc),
    replyTo: addressesOf(mail.replyTo),
    date: toIso(mail.date),
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: referencesOf(mail.references),
    text: mail.text ?? null,
    html,
    blockedImages,
    attachments: mail.attachments.map((a, index) => ({
      index,
      filename: a.filename ?? "",
      contentType: a.contentType,
      size: a.size,
      inline: a.contentDisposition === "inline" || a.related === true,
      cid: a.cid ?? null,
    })),
  };
}

/** Mengurai pesan mentah (RFC 822) dan membersihkan HTML-nya. */
export async function parseRawMessage(
  source: Buffer,
  allowImages: boolean,
  attachmentUrl?: AttachmentUrl,
): Promise<ParsedMessage> {
  // skipImageLinks: biarkan cid: apa adanya agar bisa ditulis ulang, bukan ditanam sebagai data: URI.
  const mail = await simpleParser(source, { skipImageLinks: true });
  return toParsedMessage(mail, allowImages, attachmentUrl);
}

export interface AttachmentContent {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

/** Mengambil isi satu lampiran dari pesan mentah, atau null bila indeks tidak ada. */
export async function extractAttachment(
  source: Buffer,
  index: number,
): Promise<AttachmentContent | null> {
  const mail = await simpleParser(source, { skipImageLinks: true });
  const a = mail.attachments[index];
  if (!a) return null;
  return {
    filename: a.filename ?? "",
    contentType: a.contentType,
    size: a.size,
    content: a.content,
  };
}

/** Semua lampiran biasa (bukan gambar tertanam di badan pesan); dipakai saat meneruskan. */
export async function extractAllAttachments(
  source: Buffer,
): Promise<AttachmentContent[]> {
  const mail = await simpleParser(source, { skipImageLinks: true });
  return mail.attachments
    .filter((a) => a.related !== true)
    .map((a) => ({
      filename: a.filename ?? "",
      contentType: a.contentType,
      size: a.size,
      content: a.content,
    }));
}
