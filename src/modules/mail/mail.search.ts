import type { SearchObject } from "imapflow";

/**
 * Parser pencarian ala Gmail. Fungsi murni, tidak menyentuh jaringan.
 *
 * Operator: from:, to:, subject:, has:attachment, is:unread, is:read,
 * is:starred, is:unstarred, after:YYYY-MM-DD, before:YYYY-MM-DD.
 * Teks bebas dan frasa "dalam kutip" harus cocok semuanya. Operator yang tidak
 * dikenal atau bernilai tidak valid diperlakukan sebagai teks biasa.
 */

export interface ParsedSearch {
  terms: string[];
  from: string[];
  to: string[];
  subject: string[];
  hasAttachment: boolean;
  seen?: boolean;
  flagged?: boolean;
  /** Inklusif: pesan yang diterima pada tanggal ini atau sesudahnya. */
  after?: Date;
  /** Eksklusif: pesan yang diterima sebelum tanggal ini. */
  before?: Date;
}

export const MAX_TOKENS = 12;
export const MAX_CRITERIA = 8;

const TOKEN = /[^\s":]+:"[^"]*"|"[^"]*"|\S+/g;

function unquote(value: string): string {
  let v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1);
  } else if (v.startsWith('"')) {
    v = v.slice(1);
  }
  return v.trim();
}

function parseDate(value: string): Date | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date : null;
}

function criteriaCount(p: ParsedSearch): number {
  return p.terms.length + p.from.length + p.to.length + p.subject.length;
}

/** True bila token ditangani sebagai operator (termasuk operator bernilai kosong yang diabaikan). */
function applyOperator(p: ParsedSearch, key: string, value: string): boolean {
  switch (key) {
    case "from":
    case "to":
    case "subject":
      if (value && criteriaCount(p) < MAX_CRITERIA) p[key].push(value);
      return true;
    case "has":
      if (value.toLowerCase() !== "attachment") return false;
      p.hasAttachment = true;
      return true;
    case "is": {
      const v = value.toLowerCase();
      if (v === "unread") p.seen = false;
      else if (v === "read") p.seen = true;
      else if (v === "starred") p.flagged = true;
      else if (v === "unstarred") p.flagged = false;
      else return false;
      return true;
    }
    case "after":
    case "before": {
      const date = parseDate(value);
      if (!date) return false;
      p[key] = date;
      return true;
    }
    default:
      return false;
  }
}

export function parseSearchQuery(q: string): ParsedSearch {
  const parsed: ParsedSearch = {
    terms: [],
    from: [],
    to: [],
    subject: [],
    hasAttachment: false,
  };
  const tokens = (q.match(TOKEN) ?? []).slice(0, MAX_TOKENS);
  for (const raw of tokens) {
    const op = /^([a-z]+):(.*)$/i.exec(raw);
    if (op && applyOperator(parsed, op[1]!.toLowerCase(), unquote(op[2]!))) {
      continue;
    }
    const text = unquote(raw);
    if (text && criteriaCount(parsed) < MAX_CRITERIA) parsed.terms.push(text);
  }
  return parsed;
}

/**
 * Kriteria IMAP. Tiap kriteria dicari terpisah lalu hasilnya diiriskan,
 * karena satu objek pencarian tidak bisa memuat dua nilai untuk kunci yang sama.
 * Flag dan tanggal digabung dalam satu kriteria.
 */
export function toImapSearches(p: ParsedSearch): SearchObject[] {
  const out: SearchObject[] = [];
  const flagsAndDates: SearchObject = {};
  if (p.seen !== undefined) flagsAndDates.seen = p.seen;
  if (p.flagged !== undefined) flagsAndDates.flagged = p.flagged;
  if (p.after) flagsAndDates.since = p.after;
  if (p.before) flagsAndDates.before = p.before;
  if (Object.keys(flagsAndDates).length > 0) out.push(flagsAndDates);
  for (const v of p.from) out.push({ from: v });
  for (const v of p.to) out.push({ to: v });
  for (const v of p.subject) out.push({ subject: v });
  for (const v of p.terms) out.push({ text: v });
  return out;
}

/** Pencarian harus punya minimal satu kriteria nyata. */
export function hasCriteria(p: ParsedSearch): boolean {
  return p.hasAttachment || toImapSearches(p).length > 0;
}
