import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { simpleParser } from "mailparser";
import { env } from "../../config/env.js";
import { withMailbox } from "../../lib/imap-session.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../middleware/error-handler.js";
import type { SendBody } from "../mail/mail.schema.js";
import {
  type OutgoingFile,
  type SendResult,
  sendMessage,
} from "../mail/mail.send.js";
import { loadMessageSource } from "../mail/mail.service.js";
import {
  DEFAULT_TIMEZONE,
  type IcsEvent,
  type Invitation,
  RSVP_KEYWORDS,
  type RsvpResponse,
  buildInvitationIcs,
  buildReplyIcs,
  findInvitation,
  formatWhen,
} from "./calendar.ics.js";
import {
  buildInvitationMessage,
  buildRsvpMessage,
} from "./calendar.message.js";
import {
  type InvitationBody,
  type InvitationUpdateBody,
  resolveTimes,
} from "./calendar.schema.js";

/**
 * Mengirim undangan, perubahan, pembatalan, dan balasan (RSVP) lewat jalur kirim
 * yang sama dengan email biasa, sehingga batas laju, salinan Sent, dan audit ikut berlaku.
 * Acara tidak disimpan di server: ubah dan batalkan membawa isi acara dari klien.
 */

export interface InvitationResult extends SendResult {
  eventUid: string;
  /** SEQUENCE yang dikirim; pakai ini pada ubah atau batalkan berikutnya. */
  sequence: number;
}

async function sendEvent(
  req: Request,
  auth: Express.AuthContext,
  body: InvitationBody,
  eventUid: string,
  sequence: number,
  method: "REQUEST" | "CANCEL",
): Promise<InvitationResult> {
  const resolved = resolveTimes(body);
  if (!resolved.ok) {
    throw new AppError(400, "VALIDATION_ERROR", resolved.message);
  }
  const { start, end } = resolved.times;

  const organizer = {
    name: auth.user.displayName || null,
    email: auth.user.email,
  };
  // Penyelenggara tidak dicantumkan sebagai peserta, kecuali bila hanya mengundang dirinya
  // sendiri (berguna untuk mencatat acara pribadi atau menguji).
  const others = [...new Set(body.attendees)].filter(
    (email) => email !== organizer.email.toLowerCase(),
  );
  const attendees = others.length > 0 ? others : [organizer.email];

  const event: IcsEvent = {
    eventUid,
    sequence,
    title: body.title,
    allDay: body.allDay,
    start,
    end,
    organizer,
    location: body.location,
    description: body.description,
    meetUrl: body.meetUrl,
  };
  const ics = buildInvitationIcs(method, event, attendees);
  const when = formatWhen(start, end, body.timezone, body.allDay);
  const message = buildInvitationMessage({
    method,
    sequence,
    title: body.title,
    when,
    organizerName: organizer.name ?? organizer.email,
    attendees,
    location: body.location,
    meetUrl: body.meetUrl,
    description: body.description,
  });

  const input: SendBody = {
    to: attendees,
    cc: [],
    bcc: [],
    subject: message.subject,
    text: message.text,
    html: message.html,
    references: [],
    forwardAttachments: false,
  };
  const file: OutgoingFile = {
    filename: "invite.ics",
    contentType: "text/calendar",
    content: Buffer.from(ics, "utf8"),
  };
  const result = await sendMessage(req, auth, input, [file], {
    icalEvent: { method, content: ics },
  });
  return { ...result, eventUid, sequence };
}

export async function createInvitation(
  req: Request,
  auth: Express.AuthContext,
  body: InvitationBody,
): Promise<InvitationResult> {
  const eventUid = `${randomUUID()}@${env.MAIL_DOMAIN}`;
  return sendEvent(req, auth, body, eventUid, 0, "REQUEST");
}

export async function updateInvitation(
  req: Request,
  auth: Express.AuthContext,
  eventUid: string,
  body: InvitationUpdateBody,
): Promise<InvitationResult> {
  return sendEvent(req, auth, body, eventUid, body.sequence + 1, "REQUEST");
}

export async function cancelInvitation(
  req: Request,
  auth: Express.AuthContext,
  eventUid: string,
  body: InvitationUpdateBody,
): Promise<InvitationResult> {
  return sendEvent(req, auth, body, eventUid, body.sequence + 1, "CANCEL");
}

// ---- Balasan (RSVP) ----

export interface RsvpResult {
  response: RsvpResponse;
  messageId: string;
  sentCopy: boolean;
  /** Alamat penyelenggara yang menerima balasan. */
  organizer: string;
}

function eventOf(invitation: Invitation): {
  event: IcsEvent;
  start: Date;
  end: Date;
} {
  const suffix = invitation.allDay ? "T00:00:00Z" : "";
  const start = new Date(`${invitation.start}${suffix}`);
  const end = new Date(`${invitation.end}${suffix}`);
  return {
    start,
    end,
    event: {
      eventUid: invitation.eventUid,
      sequence: invitation.sequence,
      title: invitation.title,
      allDay: invitation.allDay,
      start,
      end,
      organizer: invitation.organizer ?? { name: null, email: "" },
    },
  };
}

const MESSAGE_ID = /^<[^\s<>]+>$/;

/** Menandai pesan undangan dengan jawaban Anda. Kegagalan hanya dicatat di log. */
async function markResponse(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
  response: RsvpResponse,
): Promise<void> {
  try {
    await withMailbox(auth, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const others = Object.entries(RSVP_KEYWORDS)
          .filter(([r]) => r !== response)
          .map(([, keyword]) => keyword);
        await client.messageFlagsRemove(String(uid), others, { uid: true });
        await client.messageFlagsAdd(String(uid), [RSVP_KEYWORDS[response]], {
          uid: true,
        });
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    logger.warn({ err }, "gagal menandai jawaban undangan");
  }
}

export async function respondToInvitation(
  req: Request,
  auth: Express.AuthContext,
  folder: string,
  uid: number,
  response: RsvpResponse,
  comment?: string,
): Promise<RsvpResult> {
  const { source } = await loadMessageSource(auth, folder, uid);
  const mail = await simpleParser(source, { skipImageLinks: true });
  const invitation = findInvitation(mail.attachments);
  if (!invitation) {
    throw new AppError(
      404,
      "INVITATION_NOT_FOUND",
      "Pesan ini tidak berisi undangan",
    );
  }
  if (!invitation.canRespond || !invitation.organizer) {
    throw new AppError(
      409,
      "INVITATION_NOT_ACTIVE",
      "Undangan ini sudah dibatalkan atau tidak bisa dibalas",
    );
  }

  const me = { name: auth.user.displayName || null, email: auth.user.email };
  const { event, start, end } = eventOf(invitation);
  const ics = buildReplyIcs(event, me, response);
  const when = formatWhen(
    start,
    end,
    invitation.timezone ?? DEFAULT_TIMEZONE,
    invitation.allDay,
  );
  const message = buildRsvpMessage({
    response,
    title: invitation.title,
    when,
    responderName: me.name ?? me.email,
    comment,
  });

  const messageId =
    mail.messageId && MESSAGE_ID.test(mail.messageId) ? mail.messageId : null;
  const previous = Array.isArray(mail.references)
    ? mail.references
    : mail.references
      ? [mail.references]
      : [];
  const references = [...previous, ...(messageId ? [messageId] : [])]
    .filter((id) => MESSAGE_ID.test(id))
    .slice(-50);

  const input: SendBody = {
    to: [invitation.organizer.email],
    cc: [],
    bcc: [],
    subject: message.subject,
    text: message.text,
    html: message.html,
    references,
    forwardAttachments: false,
    ...(messageId ? { inReplyTo: messageId } : {}),
  };
  const file: OutgoingFile = {
    filename: "invite.ics",
    contentType: "text/calendar",
    content: Buffer.from(ics, "utf8"),
  };
  const sent = await sendMessage(req, auth, input, [file], {
    icalEvent: { method: "REPLY", content: ics },
  });

  await markResponse(auth, folder, uid, response);
  return {
    response,
    messageId: sent.messageId,
    sentCopy: sent.sentCopy,
    organizer: invitation.organizer.email,
  };
}
