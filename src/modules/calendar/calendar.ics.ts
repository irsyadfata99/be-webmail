import ical, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalCalendarMethod,
  ICalEventStatus,
} from "ical-generator";
import nodeIcal from "node-ical";

/**
 * Membuat dan membaca berkas kalender (iCalendar, RFC 5545/5546). Fungsi murni,
 * tidak menyentuh jaringan. ICS dari luar tidak dipercaya: ukuran, jumlah peserta,
 * dan semua teks dibatasi, dan hanya tautan http(s) yang diterima.
 */

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

const PROD_ID = "//Motionegg Studios//Webmail//ID";
export const MAX_ICS_BYTES = 256 * 1024;
const MAX_ATTENDEES = 100;
const MAX_TITLE = 200;
const MAX_LOCATION = 300;
const MAX_DESCRIPTION = 5000;
const MAX_URL = 500;

// ---- Pembuat ----

export type IcsMethod = "REQUEST" | "CANCEL" | "REPLY";
export type RsvpResponse = "accepted" | "declined" | "tentative";

export interface IcsPerson {
  name: string | null;
  email: string;
}

export interface IcsEvent {
  eventUid: string;
  sequence: number;
  title: string;
  /** Acara sehari penuh: start adalah hari pertama, end adalah hari terakhir (inklusif). */
  allDay: boolean;
  start: Date;
  end: Date;
  organizer: IcsPerson;
  location?: string | undefined;
  description?: string | undefined;
  meetUrl?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Keyword IMAP yang menandai pesan undangan yang sudah Anda balas. */
export const RSVP_KEYWORDS: Record<RsvpResponse, string> = {
  accepted: "$RsvpAccepted",
  declined: "$RsvpDeclined",
  tentative: "$RsvpTentative",
};

export function rsvpFromFlags(flags: ReadonlySet<string>): RsvpResponse | null {
  for (const [response, keyword] of Object.entries(RSVP_KEYWORDS)) {
    if (flags.has(keyword)) return response as RsvpResponse;
  }
  return null;
}

function methodOf(method: IcsMethod): ICalCalendarMethod {
  switch (method) {
    case "CANCEL":
      return ICalCalendarMethod.CANCEL;
    case "REPLY":
      return ICalCalendarMethod.REPLY;
    default:
      return ICalCalendarMethod.REQUEST;
  }
}

function organizerOf(p: IcsPerson): { name: string; email: string } {
  return { name: p.name ?? p.email, email: p.email };
}

/** ICS undangan (REQUEST) atau pembatalan (CANCEL). Waktu ditulis dalam UTC. */
export function buildInvitationIcs(
  method: "REQUEST" | "CANCEL",
  event: IcsEvent,
  attendees: readonly string[],
  now: Date = new Date(),
): string {
  const calendar = ical({ prodId: PROD_ID, method: methodOf(method) });
  const description = [
    event.description?.trim(),
    event.meetUrl ? `Bergabung: ${event.meetUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  const e = calendar.createEvent({
    id: event.eventUid,
    sequence: event.sequence,
    stamp: now,
    start: event.start,
    // DTEND hari penuh bersifat eksklusif di ICS.
    end: event.allDay ? new Date(event.end.getTime() + DAY_MS) : event.end,
    allDay: event.allDay,
    summary: event.title,
    organizer: organizerOf(event.organizer),
    status:
      method === "CANCEL"
        ? ICalEventStatus.CANCELLED
        : ICalEventStatus.CONFIRMED,
    ...(description ? { description } : {}),
    // Outlook menampilkan LOCATION; bila tidak ada lokasi fisik, pakai tautan rapat.
    ...(event.location || event.meetUrl
      ? { location: event.location ?? event.meetUrl ?? null }
      : {}),
    ...(event.meetUrl ? { url: event.meetUrl } : {}),
  });
  for (const email of attendees) {
    e.createAttendee({
      email,
      role: ICalAttendeeRole.REQ,
      rsvp: method === "REQUEST",
      status: ICalAttendeeStatus.NEEDSACTION,
    });
  }
  return calendar.toString();
}

const PARTSTAT: Record<RsvpResponse, ICalAttendeeStatus> = {
  accepted: ICalAttendeeStatus.ACCEPTED,
  declined: ICalAttendeeStatus.DECLINED,
  tentative: ICalAttendeeStatus.TENTATIVE,
};

/** ICS balasan (REPLY): hanya peserta yang menjawab yang dicantumkan. */
export function buildReplyIcs(
  event: IcsEvent,
  attendee: IcsPerson,
  response: RsvpResponse,
  now: Date = new Date(),
): string {
  const calendar = ical({ prodId: PROD_ID, method: ICalCalendarMethod.REPLY });
  const e = calendar.createEvent({
    id: event.eventUid,
    sequence: event.sequence,
    stamp: now,
    start: event.start,
    end: event.allDay ? new Date(event.end.getTime() + DAY_MS) : event.end,
    allDay: event.allDay,
    summary: event.title,
    organizer: organizerOf(event.organizer),
  });
  e.createAttendee({
    email: attendee.email,
    ...(attendee.name ? { name: attendee.name } : {}),
    status: PARTSTAT[response],
  });
  return calendar.toString();
}

// ---- Format waktu untuk teks email ----

function formatterFor(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("id-ID", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "UTC" });
  }
}

/** Contoh: "Jumat, 20 November 2026, 09.00–10.00 (Asia/Jakarta)". */
export function formatWhen(
  start: Date,
  end: Date,
  timeZone: string,
  allDay: boolean,
): string {
  const dateOnly = formatterFor(allDay ? "UTC" : timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = formatterFor(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const startDay = dateOnly.format(start);
  const endDay = dateOnly.format(end);
  if (allDay) {
    return startDay === endDay
      ? `${startDay} (sehari penuh)`
      : `${startDay} – ${endDay} (sehari penuh)`;
  }
  const sameDay = startDay === endDay;
  return sameDay
    ? `${startDay}, ${time.format(start)}–${time.format(end)} (${timeZone})`
    : `${startDay}, ${time.format(start)} – ${endDay}, ${time.format(end)} (${timeZone})`;
}

// ---- Pengurai ----

export type PartStat =
  "accepted" | "declined" | "tentative" | "needs-action" | "delegated";

export interface InvitationAttendee extends IcsPerson {
  status: PartStat;
}

export interface Invitation {
  /** METHOD dari berkas; "PUBLISH" bila tidak ada. */
  method: string;
  eventUid: string;
  sequence: number;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** ISO 8601 UTC; untuk acara sehari penuh berupa YYYY-MM-DD. */
  start: string;
  /** Sama seperti start; untuk sehari penuh adalah hari terakhir (inklusif). */
  end: string;
  /** Zona waktu asli acara bila tertera di berkas. */
  timezone: string | null;
  organizer: IcsPerson | null;
  attendees: InvitationAttendee[];
  /** Tautan rapat (Google Meet, Zoom, Teams, dan sejenisnya) bila ada. */
  meetUrl: string | null;
  cancelled: boolean;
  /** Aturan pengulangan mentah (RRULE), hanya untuk ditampilkan. */
  recurrence: string | null;
  /** Undangan aktif yang bisa dibalas dengan terima, tolak, atau mungkin. */
  canRespond: boolean;
}

const KNOWN_MEET_HOSTS =
  /(^|\.)(meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|meet\.jit\.si|whereby\.com|gotomeeting\.com|bluejeans\.com)$/i;

/** Tautan http(s) yang aman, atau null. Tanpa kredensial di dalam URL. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Tautan rapat dari kolom yang eksplisit, atau dari teks bila penyedianya dikenal. */
export function findMeetUrl(sources: {
  conference?: string | null;
  url?: string | null;
  location?: string | null;
  description?: string | null;
}): string | null {
  const explicit =
    safeHttpUrl(sources.conference) ??
    safeHttpUrl(sources.url) ??
    safeHttpUrl(sources.location);
  if (explicit) return explicit;

  const matches =
    `${sources.description ?? ""} ${sources.location ?? ""}`.match(
      /https?:\/\/[^\s<>"')]+/gi,
    );
  for (const m of matches ?? []) {
    const safe = safeHttpUrl(m.replace(/[.,;]+$/, ""));
    if (safe && KNOWN_MEET_HOSTS.test(new URL(safe).hostname)) return safe;
  }
  return null;
}

/** Teks polos dari nilai ICS: tag HTML dibuang dan karakter kontrol dihapus. */
export function plainText(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : "";
  const text = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

function paramOf(
  value: unknown,
): { val: string; cn: string | null; params: Record<string, unknown> } | null {
  if (typeof value === "string") return { val: value, cn: null, params: {} };
  if (value && typeof value === "object" && "val" in value) {
    const v = value as { val?: unknown; params?: Record<string, unknown> };
    if (typeof v.val !== "string") return null;
    const params = v.params ?? {};
    const cn = typeof params.CN === "string" ? params.CN : null;
    return { val: v.val, cn, params };
  }
  return null;
}

function personOf(
  value: unknown,
): { person: IcsPerson; params: Record<string, unknown> } | null {
  const p = paramOf(value);
  if (!p) return null;
  const email = p.val
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return null;
  const name = p.cn ? plainText(p.cn, 120) : "";
  return { person: { name: name || null, email }, params: p.params };
}

function statusOf(value: unknown): PartStat {
  switch (typeof value === "string" ? value.toUpperCase() : "") {
    case "ACCEPTED":
      return "accepted";
    case "DECLINED":
      return "declined";
    case "TENTATIVE":
      return "tentative";
    case "DELEGATED":
      return "delegated";
    default:
      return "needs-action";
  }
}

function textOf(value: unknown): string | null {
  const p = paramOf(value);
  return p ? p.val : null;
}

interface RawEvent {
  type?: string;
  uid?: unknown;
  sequence?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  url?: unknown;
  status?: unknown;
  start?: Date & { tz?: string; dateOnly?: boolean };
  end?: Date;
  datetype?: string;
  organizer?: unknown;
  attendee?: unknown;
  rrule?: unknown;
  "GOOGLE-CONFERENCE"?: unknown;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Membaca satu undangan dari teks ICS. Null bila bukan ICS yang berisi acara. */
export function parseInvitation(ics: string): Invitation | null {
  if (ics.length > MAX_ICS_BYTES) return null;
  let data: Record<string, unknown>;
  try {
    data = nodeIcal.sync.parseICS(ics) as Record<string, unknown>;
  } catch {
    return null;
  }

  const event = Object.values(data).find(
    (v): v is RawEvent =>
      typeof v === "object" && v !== null && (v as RawEvent).type === "VEVENT",
  );
  if (
    !event ||
    !(event.start instanceof Date) ||
    Number.isNaN(event.start.getTime())
  ) {
    return null;
  }

  const calendar = data.vcalendar as { method?: unknown } | undefined;
  const method =
    typeof calendar?.method === "string"
      ? calendar.method.toUpperCase()
      : "PUBLISH";

  const allDay = event.datetype === "date" || event.start.dateOnly === true;
  const startDate = event.start;
  let endDate =
    event.end instanceof Date && !Number.isNaN(event.end.getTime())
      ? event.end
      : startDate;
  // DTEND sehari penuh eksklusif; tampilkan hari terakhir (inklusif).
  if (allDay && endDate.getTime() > startDate.getTime()) {
    endDate = new Date(endDate.getTime() - DAY_MS);
  }

  const organizer = personOf(event.organizer)?.person ?? null;
  const rawAttendees = Array.isArray(event.attendee)
    ? event.attendee
    : event.attendee
      ? [event.attendee]
      : [];
  const attendees: InvitationAttendee[] = [];
  for (const a of rawAttendees.slice(0, MAX_ATTENDEES)) {
    const p = personOf(a);
    if (p) attendees.push({ ...p.person, status: statusOf(p.params.PARTSTAT) });
  }

  const location = plainText(textOf(event.location), MAX_LOCATION) || null;
  const description =
    plainText(textOf(event.description), MAX_DESCRIPTION) || null;
  const meetUrl = findMeetUrl({
    conference: textOf(event["GOOGLE-CONFERENCE"]),
    url: textOf(event.url),
    location: textOf(event.location),
    description: textOf(event.description),
  });

  const cancelled =
    method === "CANCEL" ||
    (typeof event.status === "string" &&
      event.status.toUpperCase() === "CANCELLED");

  const rrule = event.rrule
    ? /^RRULE[^:]*:(.+)$/im.exec(ics)?.[1]?.trim()
    : undefined;

  return {
    method,
    eventUid: plainText(textOf(event.uid), 255),
    sequence: Number.isFinite(Number(event.sequence))
      ? Number(event.sequence)
      : 0,
    title: plainText(textOf(event.summary), MAX_TITLE) || "(tanpa judul)",
    description,
    location,
    allDay,
    start: allDay ? isoDay(startDate) : startDate.toISOString(),
    end: allDay ? isoDay(endDate) : endDate.toISOString(),
    timezone: typeof startDate.tz === "string" ? startDate.tz : null,
    organizer,
    attendees,
    meetUrl,
    cancelled,
    recurrence: rrule ? rrule.slice(0, 200) : null,
    canRespond: method === "REQUEST" && !cancelled && organizer !== null,
  };
}

export interface CalendarPart {
  contentType: string;
  filename?: string | undefined;
  content: Buffer;
}

/** Undangan pertama yang valid dari bagian text/calendar atau lampiran .ics. */
export function findInvitation(
  parts: readonly CalendarPart[],
): Invitation | null {
  for (const part of parts) {
    const type = part.contentType.toLowerCase();
    const isIcs =
      type.startsWith("text/calendar") ||
      type === "application/ics" ||
      (part.filename ?? "").toLowerCase().endsWith(".ics");
    if (!isIcs || part.content.length > MAX_ICS_BYTES) continue;
    const invitation = parseInvitation(part.content.toString("utf8"));
    if (invitation) return invitation;
  }
  return null;
}


