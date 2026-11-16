import type { RsvpResponse } from "./calendar.ics.js";

/** Teks dan HTML email untuk undangan dan balasannya. Fungsi murni. */

const RSVP_SUBJECT: Record<RsvpResponse, string> = {
  accepted: "Diterima",
  declined: "Ditolak",
  tentative: "Mungkin",
};

const RSVP_SENTENCE: Record<RsvpResponse, string> = {
  accepted: "menerima undangan ini",
  declined: "menolak undangan ini",
  tentative: "mungkin akan hadir",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const withBreaks = (value: string): string =>
  escapeHtml(value).replace(/\r?\n/g, "<br>");

/** Subjek dibatasi agar tidak melampaui batas header. */
const clip = (value: string): string =>
  value.length > 250 ? `${value.slice(0, 247)}...` : value;

export interface InvitationMessageInput {
  method: "REQUEST" | "CANCEL";
  sequence: number;
  title: string;
  when: string;
  organizerName: string;
  attendees: readonly string[];
  location?: string | undefined;
  meetUrl?: string | undefined;
  description?: string | undefined;
}

export interface MailText {
  subject: string;
  text: string;
  html: string;
}

export function buildInvitationMessage(i: InvitationMessageInput): MailText {
  const prefix =
    i.method === "CANCEL"
      ? "Dibatalkan"
      : i.sequence > 0
        ? "Pembaruan undangan"
        : "Undangan";
  const heading =
    i.method === "CANCEL"
      ? "Acara ini dibatalkan"
      : i.sequence > 0
        ? "Acara ini diperbarui"
        : `${i.organizerName} mengundang Anda`;

  const lines: string[] = [heading, "", i.title, `Waktu: ${i.when}`];
  if (i.location) lines.push(`Lokasi: ${i.location}`);
  if (i.meetUrl && i.method === "REQUEST")
    lines.push(`Tautan rapat: ${i.meetUrl}`);
  lines.push(`Penyelenggara: ${i.organizerName}`);
  if (i.attendees.length > 0) lines.push(`Peserta: ${i.attendees.join(", ")}`);
  if (i.description) lines.push("", i.description);
  if (i.method === "REQUEST") {
    lines.push(
      "",
      "Berkas kalender (invite.ics) terlampir. Balas undangan ini dari klien email Anda.",
    );
  }

  const rows: string[] = [
    `<p><strong>${escapeHtml(heading)}</strong></p>`,
    `<p style="font-size:1.1em"><strong>${escapeHtml(i.title)}</strong></p>`,
    `<p>Waktu: ${escapeHtml(i.when)}</p>`,
  ];
  if (i.location) rows.push(`<p>Lokasi: ${escapeHtml(i.location)}</p>`);
  if (i.meetUrl && i.method === "REQUEST") {
    rows.push(
      `<p>Tautan rapat: <a href="${escapeHtml(i.meetUrl)}">${escapeHtml(i.meetUrl)}</a></p>`,
    );
  }
  rows.push(`<p>Penyelenggara: ${escapeHtml(i.organizerName)}</p>`);
  if (i.attendees.length > 0) {
    rows.push(`<p>Peserta: ${escapeHtml(i.attendees.join(", "))}</p>`);
  }
  if (i.description) rows.push(`<p>${withBreaks(i.description)}</p>`);

  return {
    subject: clip(`${prefix}: ${i.title} @ ${i.when}`),
    text: lines.join("\n"),
    html: rows.join("\n"),
  };
}

export interface RsvpMessageInput {
  response: RsvpResponse;
  title: string;
  when: string;
  responderName: string;
  comment?: string | undefined;
}

export function buildRsvpMessage(i: RsvpMessageInput): MailText {
  const sentence = `${i.responderName} ${RSVP_SENTENCE[i.response]}.`;
  const text = [sentence, "", i.title, `Waktu: ${i.when}`];
  const html = [
    `<p>${escapeHtml(sentence)}</p>`,
    `<p><strong>${escapeHtml(i.title)}</strong><br>${escapeHtml(i.when)}</p>`,
  ];
  if (i.comment) {
    text.push("", i.comment);
    html.push(`<p>${withBreaks(i.comment)}</p>`);
  }
  return {
    subject: clip(`${RSVP_SUBJECT[i.response]}: ${i.title} @ ${i.when}`),
    text: text.join("\n"),
    html: html.join("\n"),
  };
}
