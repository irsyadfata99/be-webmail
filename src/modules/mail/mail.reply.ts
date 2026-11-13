import { htmlToText } from "./mail.compose.js";
import type { MailAddress } from "./mail.utils.js";

/** Fungsi murni untuk balas, balas semua, dan teruskan. */

export type ComposeMode = "reply" | "replyAll" | "forward";

export interface OriginalMessage {
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  date: string | null;
  messageId: string | null;
  references: string[];
  text: string | null;
  html: string | null;
}

export interface ComposeDraft {
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo?: string;
  references: string[];
  text: string;
  html: string;
}

const PREFIX = /^\s*((re|fwd?|fw|balas|tr)\s*:\s*)+/i;
const MAX_QUOTE_CHARS = 50_000;
const MAX_REFERENCES = 20;

/** "Re: " atau "Fwd: " satu kali saja, tanpa menumpuk. */
export function subjectWithPrefix(
  subject: string,
  prefix: "Re:" | "Fwd:",
): string {
  const base = subject.replace(PREFIX, "").trim();
  return base ? `${prefix} ${base}` : prefix;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unique(addresses: string[]): string[] {
  return [...new Set(addresses.map((a) => a.toLowerCase()))];
}

/**
 * Penerima balasan. Balas ke Reply-To bila ada, kalau tidak ke pengirim.
 * Bila pesan asli dikirim oleh diri sendiri (dari folder Sent), balasan ke penerima aslinya.
 * Balas semua: sisa penerima asli masuk Cc, tanpa alamat sendiri dan tanpa duplikat.
 */
export function replyRecipients(
  original: Pick<OriginalMessage, "from" | "to" | "cc" | "replyTo">,
  self: string,
  mode: "reply" | "replyAll",
): { to: string[]; cc: string[] } {
  const me = self.toLowerCase();
  const sentByMe = original.from.some((a) => a.address.toLowerCase() === me);
  const primary = sentByMe
    ? original.to
    : original.replyTo.length > 0
      ? original.replyTo
      : original.from;

  const to = unique(primary.map((a) => a.address)).filter((a) => a !== me);
  if (mode === "reply") return { to, cc: [] };

  const cc = unique(
    [...original.to, ...original.cc].map((a) => a.address),
  ).filter((a) => a !== me && !to.includes(a));
  return { to, cc };
}

/** Rantai References: milik pesan asli ditambah Message-ID-nya, maksimal 20 terakhir. */
export function buildReferences(
  original: Pick<OriginalMessage, "references" | "messageId">,
): string[] {
  const chain = [...original.references];
  if (original.messageId) chain.push(original.messageId);
  return [...new Set(chain)].slice(-MAX_REFERENCES);
}

function formatAddress(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

function formatList(list: MailAddress[]): string {
  return list.map(formatAddress).join(", ");
}

function formatDate(iso: string | null): string {
  return iso
    ? `${iso.slice(0, 16).replace("T", " ")} UTC`
    : "tanggal tidak diketahui";
}

function originalText(original: OriginalMessage): string {
  const text =
    original.text ?? (original.html ? htmlToText(original.html) : "");
  return text.slice(0, MAX_QUOTE_CHARS);
}

function originalHtml(original: OriginalMessage): string {
  if (original.html) return original.html.slice(0, MAX_QUOTE_CHARS * 4);
  return `<p>${escapeHtml(originalText(original)).replace(/\r?\n/g, "<br>")}</p>`;
}

/** Menyusun draf untuk dikirim lewat POST /send. Isi asli dikutip dan HTML-nya sudah tersanitasi. */
export function buildComposeDraft(
  original: OriginalMessage,
  mode: ComposeMode,
  self: string,
): ComposeDraft {
  if (mode === "forward") {
    const header = [
      "---------- Pesan terusan ----------",
      `Dari: ${formatList(original.from)}`,
      `Tanggal: ${formatDate(original.date)}`,
      `Subjek: ${original.subject}`,
      `Kepada: ${formatList(original.to)}`,
    ];
    if (original.cc.length > 0) header.push(`Cc: ${formatList(original.cc)}`);
    const body = originalText(original);
    return {
      to: [],
      cc: [],
      subject: subjectWithPrefix(original.subject, "Fwd:"),
      references: [],
      text: `\n\n${header.join("\n")}\n\n${body}`,
      html:
        `<p></p><p>${header.map(escapeHtml).join("<br>")}</p>` +
        `<blockquote>${originalHtml(original)}</blockquote>`,
    };
  }

  const { to, cc } = replyRecipients(original, self, mode);
  const who = original.from[0] ? formatAddress(original.from[0]) : "pengirim";
  const intro = `Pada ${formatDate(original.date)}, ${who} menulis:`;
  const quotedText = originalText(original)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");

  return {
    to,
    cc,
    subject: subjectWithPrefix(original.subject, "Re:"),
    inReplyTo: original.messageId ?? undefined,
    references: buildReferences(original),
    text: `\n\n${intro}\n${quotedText}`,
    html:
      `<p></p><p>${escapeHtml(intro)}</p>` +
      `<blockquote>${originalHtml(original)}</blockquote>`,
  };
}
