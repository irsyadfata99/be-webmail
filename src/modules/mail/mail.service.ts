import type { FetchMessageObject, ImapFlow } from "imapflow";
import { env } from "../../config/env.js";
import { GateFullError, createGate } from "../../lib/gate.js";
import { withMailbox } from "../../lib/imap-session.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  type AttachmentContent,
  type ParsedMessage,
  extractAllAttachments,
  extractAttachment,
  parseRawMessage,
} from "./mail.parse.js";
import {
  type ComposeDraft,
  type ComposeMode,
  buildComposeDraft,
} from "./mail.reply.js";
import {
  type FolderInfo,
  type MailAddress,
  folderRole,
  hasAttachment,
  pageRange,
  sortFolders,
  toAddresses,
  toIso,
} from "./mail.utils.js";

export interface MessageSummary {
  uid: number;
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  date: string | null;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachments: boolean;
}

export interface MessagePage {
  folder: string;
  total: number;
  page: number;
  pageSize: number;
  messages: MessageSummary[];
}

export async function listFolders(
  auth: Express.AuthContext,
): Promise<FolderInfo[]> {
  return withMailbox(auth, async (client) => {
    const boxes = await client.list({
      statusQuery: { messages: true, unseen: true },
    });

    const folders: FolderInfo[] = boxes
      .filter(
        (box) =>
          !box.flags.has("\\Noselect") && !box.flags.has("\\NonExistent"),
      )
      .map((box) => ({
        path: box.path,
        name: box.name,
        delimiter: box.delimiter ?? null,
        role: folderRole(box.path, box.specialUse, box.name),
        messages: box.status?.messages ?? 0,
        unseen: box.status?.unseen ?? 0,
        subscribed: box.subscribed ?? true,
      }));

    return sortFolders(folders);
  });
}

export async function listMessages(
  auth: Express.AuthContext,
  folder: string,
  page: number,
  pageSize: number,
): Promise<MessagePage> {
  return withMailbox(auth, async (client) => {
    const lock = await lockFolder(client, folder);
    try {
      const mailbox = client.mailbox;
      const total = mailbox ? mailbox.exists : 0;
      const range = pageRange(total, page, pageSize);
      if (!range) return { folder, total, page, pageSize, messages: [] };

      const messages: MessageSummary[] = [];
      for await (const msg of client.fetch(`${range.low}:${range.high}`, {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
      })) {
        messages.push(toSummary(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);

      return { folder, total, page, pageSize, messages };
    } finally {
      lock.release();
    }
  });
}

/** Batas ukuran pesan yang boleh dibuka (dari MAX_MESSAGE_MB; setara batas terima Gmail 50 MB). */
const MAX_MESSAGE_BYTES = env.MAX_MESSAGE_MB * 1024 * 1024;

/**
 * Pesan di atas ini diurai paling banyak 2 sekaligus (antrean 10), karena mengurai
 * pesan besar memakai memori beberapa kali ukurannya.
 */
const HEAVY_MESSAGE_BYTES = 10 * 1024 * 1024;
const heavyGate = createGate(2, 10);

export interface MessageDetail extends ParsedMessage {
  folder: string;
  uid: number;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
}

export async function getMessage(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
  options: { images: boolean; markSeen: boolean },
): Promise<MessageDetail> {
  return withMailbox(auth, async (client) => {
    // Kunci baca-saja kecuali pengguna meminta menandai pesan sebagai dibaca.
    const lock = await lockFolder(client, folder, !options.markSeen);
    try {
      return await withSource(client, uid, async (meta, source) => {
        const parsed = await parseRawMessage(
          source,
          options.images,
          (index) =>
            `/api/mail/messages/${uid}/attachments/${index}?folder=${encodeURIComponent(folder)}&inline=1`,
        );
        const flags = meta.flags ?? new Set<string>();
        let seen = flags.has("\\Seen");
        if (options.markSeen && !seen) {
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          seen = true;
        }

        return {
          ...parsed,
          folder,
          uid,
          size: meta.size ?? 0,
          seen,
          flagged: flags.has("\\Flagged"),
          answered: flags.has("\\Answered"),
          draft: flags.has("\\Draft"),
        };
      });
    } finally {
      lock.release();
    }
  });
}

export async function getComposeDraft(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
  mode: ComposeMode,
): Promise<
  ComposeDraft & {
    original: { folder: string; uid: number; kind: "reply" | "forward" };
  }
> {
  return withMailbox(auth, async (client) => {
    const lock = await lockFolder(client, folder);
    try {
      const parsed = await withSource(client, uid, (_meta, source) =>
        // Gambar eksternal tetap diblokir pada kutipan.
        parseRawMessage(source, false),
      );
      const draft = buildComposeDraft(parsed, mode, auth.user.email);
      return {
        ...draft,
        original: {
          folder,
          uid,
          kind: mode === "forward" ? "forward" : "reply",
        },
      };
    } finally {
      lock.release();
    }
  });
}

/** Lampiran pesan asli untuk diteruskan, diambil langsung dari server mail. */
export async function loadForwardAttachments(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
): Promise<AttachmentContent[]> {
  return withMailbox(auth, async (client) => {
    const lock = await lockFolder(client, folder);
    try {
      return await withSource(client, uid, (_meta, source) =>
        extractAllAttachments(source),
      );
    } finally {
      lock.release();
    }
  });
}

export async function getAttachment(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
  index: number,
): Promise<AttachmentContent> {
  return withMailbox(auth, async (client) => {
    const lock = await lockFolder(client, folder);
    try {
      const attachment = await withSource(client, uid, (_meta, source) =>
        extractAttachment(source, index),
      );
      if (!attachment) {
        throw new AppError(
          404,
          "ATTACHMENT_NOT_FOUND",
          "Lampiran tidak ditemukan",
        );
      }
      return attachment;
    } finally {
      lock.release();
    }
  });
}

type MessageMeta = FetchMessageObject;

/**
 * Mengambil metadata, memeriksa batas ukuran, mengunduh isi mentah, lalu menjalankan `fn`.
 * Pesan besar melewati `heavyGate` selama diunduh dan diurai, agar memori tidak jebol.
 */
async function withSource<T>(
  client: ImapFlow,
  uid: number,
  fn: (meta: MessageMeta, source: Buffer) => Promise<T>,
): Promise<T> {
  const meta = await client.fetchOne(
    String(uid),
    { uid: true, flags: true, size: true },
    { uid: true },
  );
  if (!meta) {
    throw new AppError(404, "MESSAGE_NOT_FOUND", "Pesan tidak ditemukan");
  }
  const size = meta.size ?? 0;
  if (size > MAX_MESSAGE_BYTES) {
    throw new AppError(
      413,
      "MESSAGE_TOO_LARGE",
      "Pesan terlalu besar untuk ditampilkan",
    );
  }

  const run = async (): Promise<T> => {
    const full = await client.fetchOne(
      String(uid),
      { uid: true, source: true },
      { uid: true },
    );
    if (!full || !full.source) {
      throw new AppError(404, "MESSAGE_NOT_FOUND", "Pesan tidak ditemukan");
    }
    return fn(meta, full.source);
  };

  if (size <= HEAVY_MESSAGE_BYTES) return run();
  try {
    return await heavyGate.run(run);
  } catch (err) {
    if (err instanceof GateFullError) {
      throw new AppError(
        503,
        "SERVER_BUSY",
        "Server sedang memproses banyak pesan besar. Coba lagi sebentar lagi.",
      );
    }
    throw err;
  }
}

async function lockFolder(client: ImapFlow, folder: string, readOnly = true) {
  try {
    return await client.getMailboxLock(folder, { readOnly });
  } catch (err) {
    throw folderError(err);
  }
}

function folderError(err: unknown): unknown {
  const e = err as {
    serverResponseCode?: string;
    responseText?: string;
    message?: string;
  };
  const text = `${e.serverResponseCode ?? ""} ${e.responseText ?? ""} ${e.message ?? ""}`;
  if (/NONEXISTENT|does not exist|doesn't exist|unknown mailbox/i.test(text)) {
    return new AppError(404, "FOLDER_NOT_FOUND", "Folder tidak ditemukan");
  }
  return err;
}

function toSummary(msg: FetchMessageObject): MessageSummary {
  const flags = msg.flags ?? new Set<string>();
  const envelope = msg.envelope;
  return {
    uid: msg.uid,
    subject: envelope?.subject ?? "",
    from: toAddresses(envelope?.from),
    to: toAddresses(envelope?.to),
    date: toIso(envelope?.date, msg.internalDate),
    size: msg.size ?? 0,
    seen: flags.has("\\Seen"),
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    draft: flags.has("\\Draft"),
    hasAttachments: hasAttachment(msg.bodyStructure),
  };
}
