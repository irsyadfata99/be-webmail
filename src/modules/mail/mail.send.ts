import type { Request } from "express";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { env } from "../../config/env.js";
import {
  decryptCredential,
  revokeSessionForBadCredential,
  withMailbox,
} from "../../lib/imap-session.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  SENDS_PER_HOUR,
  allRecipients,
  buildMailOptions,
} from "./mail.compose.js";
import { deleteDraftQuietly, loadDraftAttachments } from "./mail.draft.js";
import { smtpError } from "./mail.errors.js";
import type { SendBody } from "./mail.schema.js";
import {
  checkOutgoingAttachments,
  checkTotalBytes,
  downloadContentType,
  safeFilename,
  type OutgoingProblem,
} from "./mail.attachment.js";
import { loadForwardAttachments } from "./mail.service.js";
import { folderRole } from "./mail.utils.js";

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  /** Salinan di folder Sent berhasil disimpan. */
  sentCopy: boolean;
}

export interface OutgoingFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

function problemToError(p: OutgoingProblem): AppError {
  return new AppError(p.status, p.code, p.message);
}

export const AUDIT_MAIL_SENT = "MAIL_SENT";
export const AUDIT_MAIL_SEND_FAILED = "MAIL_SEND_FAILED";

type AuditMeta = Record<string, string | number | boolean | null>;

const SEND_WINDOW_MS = 60 * 60 * 1000;

function tooManySends(): AppError {
  return new AppError(
    429,
    "SEND_LIMIT_REACHED",
    "Batas pengiriman per jam tercapai. Coba lagi nanti.",
  );
}

/** Pemeriksaan cepat sebelum pekerjaan berat. Tidak atomik; yang mengikat adalah reserveSendSlot. */
async function assertWithinSendLimit(userId: string): Promise<void> {
  const count = await prisma.auditLog.count({
    where: {
      actorId: userId,
      action: AUDIT_MAIL_SENT,
      createdAt: { gte: new Date(Date.now() - SEND_WINDOW_MS) },
    },
  });
  if (count >= SENDS_PER_HOUR) throw tooManySends();
}

/**
 * Memesan satu jatah kirim secara atomik: hitung dan catat dalam satu transaksi
 * dengan kunci per pengguna, sehingga permintaan paralel tidak bisa melewati batas.
 * Catatan ini diperbarui setelah kirim (berhasil atau gagal).
 */
export async function reserveSendSlot(
  req: Request,
  userId: string,
): Promise<string> {
  const since = new Date(Date.now() - SEND_WINDOW_MS);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const count = await tx.auditLog.count({
      where: {
        actorId: userId,
        action: AUDIT_MAIL_SENT,
        createdAt: { gte: since },
      },
    });
    if (count >= SENDS_PER_HOUR) throw tooManySends();
    const row = await tx.auditLog.create({
      data: {
        actorId: userId,
        action: AUDIT_MAIL_SENT,
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
        metadata: { pending: true },
      },
      select: { id: true },
    });
    return row.id;
  });
}

/** Menutup catatan jatah kirim. Kegagalan di sini hanya dicatat di log. */
async function finalizeSendSlot(
  id: string,
  action: string,
  metadata: AuditMeta,
): Promise<void> {
  try {
    await prisma.auditLog.update({ where: { id }, data: { action, metadata } });
  } catch (err) {
    logger.error({ err, id }, "gagal memperbarui catatan pengiriman");
  }
}

/** Menyimpan salinan ke folder Sent. Kegagalan di sini tidak membatalkan pengiriman. */
async function saveToSent(
  auth: Express.AuthContext,
  raw: Buffer,
): Promise<boolean> {
  try {
    return await withMailbox(auth, async (client) => {
      const boxes = await client.list();
      const sent = boxes.find(
        (b) =>
          !b.flags.has("\\Noselect") &&
          folderRole(b.path, b.specialUse, b.name) === "sent",
      );
      if (!sent) return false;
      await client.append(sent.path, raw, ["\\Seen"]);
      return true;
    });
  } catch (err) {
    logger.warn({ err }, "gagal menyimpan salinan ke folder Sent");
    return false;
  }
}

/** Menandai pesan asal sebagai dibalas atau diteruskan. Kegagalan diabaikan. */
async function markOriginal(
  auth: Express.AuthContext,
  original: NonNullable<SendBody["original"]>,
): Promise<void> {
  try {
    await withMailbox(auth, async (client) => {
      const lock = await client.getMailboxLock(original.folder);
      try {
        const flag = original.kind === "reply" ? "\\Answered" : "$Forwarded";
        await client.messageFlagsAdd(String(original.uid), [flag], {
          uid: true,
        });
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    logger.warn({ err }, "gagal menandai pesan asal");
  }
}

export async function sendMessage(
  req: Request,
  auth: Express.AuthContext,
  input: SendBody,
  uploads: OutgoingFile[] = [],
): Promise<SendResult> {
  const uploaded = uploads.map((f, i) => ({
    ...f,
    filename: safeFilename(f.filename, `lampiran-${i + 1}`),
  }));
  const problem = checkOutgoingAttachments(
    uploaded.map((f) => ({ filename: f.filename, size: f.content.length })),
    env.MAX_ATTACHMENT_MB * 1024 * 1024,
  );
  if (problem) throw problemToError(problem);

  await assertWithinSendLimit(auth.user.id);

  const forwarded: OutgoingFile[] = [];
  if (input.forwardAttachments && input.original) {
    const originals = await loadForwardAttachments(
      auth,
      input.original.folder,
      input.original.uid,
    );
    originals.forEach((a, i) =>
      forwarded.push({
        filename: safeFilename(a.filename, `lampiran-terusan-${i + 1}`),
        contentType: a.contentType,
        content: a.content,
      }),
    );
  }
  if (input.draft && input.draft.keepAttachments.length > 0) {
    const kept = await loadDraftAttachments(
      auth,
      input.draft.uid,
      input.draft.keepAttachments,
    );
    kept.forEach((a, i) =>
      forwarded.push({
        filename: safeFilename(a.filename, `lampiran-draf-${i + 1}`),
        contentType: a.contentType,
        content: a.content,
      }),
    );
  }
  const attachments = [...uploaded, ...forwarded];
  const totalProblem = checkTotalBytes(
    attachments.reduce((sum, f) => sum + f.content.length, 0),
    env.MAX_TOTAL_ATTACHMENT_MB * 1024 * 1024,
  );
  if (totalProblem) throw problemToError(totalProblem);

  const options = buildMailOptions(
    input,
    { address: auth.user.email, displayName: auth.user.displayName },
    env.MAIL_DOMAIN,
  );
  if (attachments.length > 0) {
    options.attachments = attachments.map((f) => ({
      filename: f.filename,
      content: f.content,
      contentType: downloadContentType(f.contentType),
    }));
  }

  // Salinan untuk Sent dibangun dengan Bcc, yang tidak ikut di pesan yang dikirim.
  const builder = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  // keepBcc didukung nodemailer saat runtime tetapi belum ada di tipe SendMailOptions.
  const copyOptions = { ...options, keepBcc: true } as SendMailOptions;
  const built = (await builder.sendMail(copyOptions)) as unknown as {
    message: Buffer;
  };
  const raw = built.message;

  // Dekripsi dulu, sebelum jatah kirim dipesan, agar sesi rusak tidak memakai jatah.
  const password = decryptCredential(auth);
  const slotId = await reserveSendSlot(req, auth.user.id);

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: auth.user.email, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  let info: { accepted: unknown[]; rejected: unknown[] };
  try {
    info = (await transport.sendMail(options)) as unknown as typeof info;
  } catch (err) {
    const mapped = smtpError(err);
    await finalizeSendSlot(slotId, AUDIT_MAIL_SEND_FAILED, {
      reason: mapped.code,
    });
    if (mapped.code === "MAIL_CREDENTIAL_INVALID") {
      await revokeSessionForBadCredential(auth);
    }
    throw mapped;
  } finally {
    transport.close();
  }

  const sentCopy = await saveToSent(auth, raw);
  if (input.original) await markOriginal(auth, input.original);
  if (input.draft) await deleteDraftQuietly(auth, input.draft.uid);

  await finalizeSendSlot(slotId, AUDIT_MAIL_SENT, {
    recipients: allRecipients(input).length,
    hasHtml: Boolean(input.html),
    attachments: attachments.length,
    sentCopy,
  });

  return {
    messageId: String(options.messageId),
    accepted: info.accepted.map(String),
    rejected: info.rejected.map(String),
    sentCopy,
  };
}
