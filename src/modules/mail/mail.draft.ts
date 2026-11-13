import type { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { env } from "../../config/env.js";
import { withMailbox } from "../../lib/imap-session.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  checkOutgoingAttachments,
  checkTotalBytes,
  downloadContentType,
  safeFilename,
  type OutgoingProblem,
} from "./mail.attachment.js";
import {
  buildDraftOptions,
  isEmptyDraft,
  parseSavedDraft,
  pickDraftAttachments,
  type PickedAttachment,
  type SavedDraftContent,
} from "./mail.saved-draft.js";
import type { DraftBody } from "./mail.schema.js";
import { loadForwardAttachments } from "./mail.service.js";
import { folderRole } from "./mail.utils.js";

/**
 * Draf tersimpan di folder Drafts (IMAP), tidak memakai jatah kirim per jam.
 * IMAP tidak bisa mengedit pesan di tempat, jadi memperbarui draf berarti
 * menyimpan versi baru lalu menghapus versi lama. Urutan ini disengaja:
 * bila langkah kedua gagal, hasilnya draf ganda, bukan draf hilang.
 */

const MAX_DRAFT_BYTES = 30 * 1024 * 1024;

export interface DraftFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface SaveDraftResult {
  /** False bila draf kosong sehingga tidak disimpan (draf lama, bila ada, dihapus). */
  saved: boolean;
  /** UID draf yang baru. Wajib dipakai pada simpan berikutnya sebagai replaceUid. */
  uid: number | null;
  folder: string | null;
}

export interface SavedDraft extends SavedDraftContent {
  uid: number;
  folder: string;
}

function problemToError(p: OutgoingProblem): AppError {
  return new AppError(p.status, p.code, p.message);
}

async function draftsPath(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  const box = boxes.find(
    (b) =>
      !b.flags.has("\\Noselect") &&
      folderRole(b.path, b.specialUse, b.name) === "drafts",
  );
  if (!box) {
    throw new AppError(
      404,
      "DRAFTS_FOLDER_NOT_FOUND",
      "Folder Drafts tidak ditemukan di mail server",
    );
  }
  return box.path;
}

async function readDraftSource(
  client: ImapFlow,
  folder: string,
  uid: number,
): Promise<Buffer> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const meta = await client.fetchOne(
      String(uid),
      { uid: true, size: true },
      { uid: true },
    );
    if (!meta)
      throw new AppError(404, "DRAFT_NOT_FOUND", "Draf tidak ditemukan");
    if ((meta.size ?? 0) > MAX_DRAFT_BYTES) {
      throw new AppError(413, "MESSAGE_TOO_LARGE", "Draf terlalu besar");
    }
    const full = await client.fetchOne(
      String(uid),
      { uid: true, source: true },
      { uid: true },
    );
    if (!full || !full.source) {
      throw new AppError(404, "DRAFT_NOT_FOUND", "Draf tidak ditemukan");
    }
    return full.source;
  } finally {
    lock.release();
  }
}

async function deleteUid(
  client: ImapFlow,
  folder: string,
  uid: number,
): Promise<void> {
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageDelete(String(uid), { uid: true });
  } finally {
    lock.release();
  }
}

/** Dipakai bila server tidak mengembalikan UID hasil APPEND (tanpa UIDPLUS). */
async function findUidByMessageId(
  client: ImapFlow,
  folder: string,
  messageId: string,
): Promise<number | null> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const found = await client.search(
      { header: { "message-id": messageId } },
      { uid: true },
    );
    return found && found.length > 0 ? Math.max(...found) : null;
  } finally {
    lock.release();
  }
}

export async function getSavedDraft(
  auth: Express.AuthContext,
  uid: number,
): Promise<SavedDraft> {
  return withMailbox(auth, async (client) => {
    const folder = await draftsPath(client);
    const source = await readDraftSource(client, folder, uid);
    const content = await parseSavedDraft(source);
    return { uid, folder, ...content };
  });
}

export async function deleteSavedDraft(
  auth: Express.AuthContext,
  uid: number,
): Promise<void> {
  await withMailbox(auth, async (client) => {
    const folder = await draftsPath(client);
    await deleteUid(client, folder, uid);
  });
}

/** Menghapus draf setelah pesan terkirim. Kegagalan di sini hanya dicatat di log. */
export async function deleteDraftQuietly(
  auth: Express.AuthContext,
  uid: number,
): Promise<void> {
  try {
    await deleteSavedDraft(auth, uid);
  } catch (err) {
    logger.warn({ err }, "gagal menghapus draf setelah terkirim");
  }
}

/** Lampiran dari draf tersimpan, dipakai saat draf dikirim atau diperbarui. */
export async function loadDraftAttachments(
  auth: Express.AuthContext,
  uid: number,
  indexes: readonly number[],
): Promise<PickedAttachment[]> {
  return withMailbox(auth, async (client) => {
    const folder = await draftsPath(client);
    const source = await readDraftSource(client, folder, uid);
    const picked = await pickDraftAttachments(source, indexes);
    if (!picked) {
      throw new AppError(
        400,
        "DRAFT_ATTACHMENT_NOT_FOUND",
        "Lampiran draf tidak ditemukan",
      );
    }
    return picked;
  });
}

export async function saveDraft(
  auth: Express.AuthContext,
  input: DraftBody,
  uploads: DraftFile[] = [],
): Promise<SaveDraftResult> {
  const uploaded = uploads.map((f, i) => ({
    ...f,
    filename: safeFilename(f.filename, `lampiran-${i + 1}`),
  }));
  const problem = checkOutgoingAttachments(
    uploaded.map((f) => ({ filename: f.filename, size: f.content.length })),
    env.MAX_ATTACHMENT_MB * 1024 * 1024,
  );
  if (problem) throw problemToError(problem);

  const carried: DraftFile[] = [];
  // Lampiran pesan asal hanya dibawa pada simpan pertama; setelah itu sudah ada di draf.
  if (input.forwardAttachments && input.original && !input.replaceUid) {
    const originals = await loadForwardAttachments(
      auth,
      input.original.folder,
      input.original.uid,
    );
    originals.forEach((a, i) =>
      carried.push({
        filename: safeFilename(a.filename, `lampiran-terusan-${i + 1}`),
        contentType: a.contentType,
        content: a.content,
      }),
    );
  }
  if (input.replaceUid && input.keepAttachments.length > 0) {
    const kept = await loadDraftAttachments(
      auth,
      input.replaceUid,
      input.keepAttachments,
    );
    kept.forEach((a, i) =>
      carried.push({
        filename: safeFilename(a.filename, `lampiran-draf-${i + 1}`),
        contentType: a.contentType,
        content: a.content,
      }),
    );
  }

  const attachments = [...uploaded, ...carried];
  const totalProblem = checkTotalBytes(
    attachments.reduce((sum, f) => sum + f.content.length, 0),
    env.MAX_TOTAL_ATTACHMENT_MB * 1024 * 1024,
  );
  if (totalProblem) throw problemToError(totalProblem);

  // Draf yang benar-benar kosong tidak disimpan; draf lama yang dikosongkan dihapus.
  if (attachments.length === 0 && isEmptyDraft(input)) {
    if (input.replaceUid) await deleteSavedDraft(auth, input.replaceUid);
    return { saved: false, uid: null, folder: null };
  }

  const options = buildDraftOptions(
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

  // Bcc ikut disimpan di draf (keepBcc), karena draf belum dikirim.
  const builder = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built = (await builder.sendMail({
    ...options,
    keepBcc: true,
  } as SendMailOptions)) as unknown as { message: Buffer };

  return withMailbox(auth, async (client) => {
    const folder = await draftsPath(client);
    const appended = await client.append(folder, built.message, [
      "\\Draft",
      "\\Seen",
    ]);
    let uid =
      appended && typeof appended.uid === "number" ? appended.uid : null;
    if (uid === null) {
      uid = await findUidByMessageId(client, folder, String(options.messageId));
    }

    if (input.replaceUid && input.replaceUid !== uid) {
      try {
        await deleteUid(client, folder, input.replaceUid);
      } catch (err) {
        logger.warn({ err }, "gagal menghapus versi lama draf");
      }
    }
    return { saved: true, uid, folder };
  });
}
