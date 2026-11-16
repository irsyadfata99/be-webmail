import { z } from "zod";
import {
  folderPath,
  messageParams,
  noControlChars,
  noLineBreaks,
  recipient,
} from "../mail/mail.schema.js";
import { MAX_RECIPIENTS } from "../mail/mail.compose.js";
import { DEFAULT_TIMEZONE, safeHttpUrl } from "./calendar.ics.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMED_DAYS = 30;
const MAX_ALL_DAY_DAYS = 366;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Hari penuh sebagai Date UTC tengah malam, atau null bila bukan tanggal kalender yang valid. */
function parseDateOnly(value: string): Date | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const date = new Date(`${value}T00:00:00Z`);
  const valid =
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(m[1]) &&
    date.getUTCMonth() + 1 === Number(m[2]) &&
    date.getUTCDate() === Number(m[3]);
  return valid ? date : null;
}

/** Waktu ISO 8601 yang wajib menyertakan zona (Z atau +07:00). */
function parseDateTime(value: string): Date | null {
  if (!DATE_TIME.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ResolvedTimes {
  start: Date;
  end: Date;
}

/** Waktu acara sebagai Date (UTC), atau pesan kesalahan untuk bidang yang salah. */
export function resolveTimes(b: {
  allDay: boolean;
  start: string;
  end: string;
}):
  | { ok: true; times: ResolvedTimes }
  | { ok: false; path: "start" | "end"; message: string } {
  const parse = b.allDay ? parseDateOnly : parseDateTime;
  const hint = b.allDay
    ? "format YYYY-MM-DD untuk acara sehari penuh"
    : "format ISO 8601 dengan zona, mis. 2026-11-20T09:00:00+07:00";
  const start = parse(b.start);
  if (!start) return { ok: false, path: "start", message: hint };
  const end = parse(b.end);
  if (!end) return { ok: false, path: "end", message: hint };

  if (b.allDay) {
    if (end.getTime() < start.getTime()) {
      return {
        ok: false,
        path: "end",
        message: "end tidak boleh sebelum start",
      };
    }
    if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_ALL_DAY_DAYS) {
      return {
        ok: false,
        path: "end",
        message: `maksimal ${MAX_ALL_DAY_DAYS} hari`,
      };
    }
  } else {
    if (end.getTime() <= start.getTime()) {
      return { ok: false, path: "end", message: "end harus sesudah start" };
    }
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_TIMED_DAYS) {
      return {
        ok: false,
        path: "end",
        message: `durasi maksimal ${MAX_TIMED_DAYS} hari`,
      };
    }
  }
  return { ok: true, times: { start, end } };
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => safeHttpUrl(v) !== null,
    "tautan harus http atau https yang valid",
  );

const shape = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(noLineBreaks, "judul tidak boleh berisi baris baru"),
  allDay: z.boolean().default(false),
  start: z.string().trim().max(40),
  end: z.string().trim().max(40),
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine(isValidTimeZone, "zona waktu tidak dikenal")
    .default(DEFAULT_TIMEZONE),
  attendees: z.array(recipient).min(1).max(MAX_RECIPIENTS),
  location: z
    .string()
    .trim()
    .max(300)
    .refine(noControlChars, "lokasi tidak valid")
    .optional(),
  description: z.string().trim().max(5000).optional(),
  // Tautan rapat manual (Google Meet, Zoom, dan sejenisnya).
  meetUrl: httpUrl.optional(),
};

type TimesInput = { allDay: boolean; start: string; end: string };

function checkTimes(b: TimesInput, ctx: z.RefinementCtx): void {
  const r = resolveTimes(b);
  if (!r.ok)
    ctx.addIssue({ code: "custom", path: [r.path], message: r.message });
}

export const invitationBody = z.object(shape).superRefine(checkTimes);
export type InvitationBody = z.infer<typeof invitationBody>;

/** Ubah atau batalkan: sequence terakhir yang diketahui klien; server menaikkannya satu. */
export const invitationUpdateBody = z
  .object({ ...shape, sequence: z.number().int().min(0).max(1000) })
  .superRefine(checkTimes);
export type InvitationUpdateBody = z.infer<typeof invitationUpdateBody>;

export const eventUidParams = z.object({
  eventUid: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[A-Za-z0-9._@-]+$/, "eventUid tidak valid"),
});

export const RSVP_RESPONSES = ["accepted", "declined", "tentative"] as const;

export const rsvpParams = z.object({ uid: messageParams.shape.uid });

export const rsvpBody = z.object({
  folder: folderPath,
  response: z.enum(RSVP_RESPONSES),
  comment: z.string().trim().max(500).optional(),
});
export type RsvpBody = z.infer<typeof rsvpBody>;
