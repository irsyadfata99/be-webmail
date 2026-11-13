import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import type { SendMailOptions } from "nodemailer";
import { sanitizeEmailHtml } from "./mail.sanitize.js";

/** Batas pengiriman. Sengaja konstanta di kode; pindahkan ke env bila perlu disetel per server. */
export const MAX_RECIPIENTS = 50;
export const SENDS_PER_HOUR = 30;

export interface SendInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references: string[];
}

export interface Sender {
  address: string;
  displayName: string;
}

/** Semua penerima unik (huruf kecil) dari to, cc, dan bcc. */
export function allRecipients(
  input: Pick<SendInput, "to" | "cc" | "bcc">,
): string[] {
  return [...new Set([...input.to, ...input.cc, ...input.bcc])];
}

/** Teks polos dari HTML, dipakai bila pengguna hanya mengirim HTML. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanName(name: string): string {
  return [...name]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/["<>]/g, "")
    .trim()
    .slice(0, 100);
}

/**
 * Menyusun opsi pesan. Pengirim (From) selalu dari sesi, tidak pernah dari input.
 * HTML dibersihkan dengan pembersih yang sama dengan tahap baca.
 */
export function buildMailOptions(
  input: SendInput,
  sender: Sender,
  mailDomain: string,
  now: Date = new Date(),
): SendMailOptions {
  const html = input.html
    ? sanitizeEmailHtml(input.html, true).html
    : undefined;
  const text = input.text ?? (html ? htmlToText(html) : "");

  return {
    from: { name: cleanName(sender.displayName), address: sender.address },
    to: input.to,
    cc: input.cc.length > 0 ? input.cc : undefined,
    bcc: input.bcc.length > 0 ? input.bcc : undefined,
    subject: input.subject,
    text,
    html,
    date: now,
    messageId: `<${randomUUID()}@${mailDomain}>`,
    inReplyTo: input.inReplyTo,
    references: input.references.length > 0 ? input.references : undefined,
  };
}
