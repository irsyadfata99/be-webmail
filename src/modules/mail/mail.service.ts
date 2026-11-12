import type { FetchMessageObject, ImapFlow } from "imapflow";
import { withMailbox } from "../../lib/imap-session.js";
import { AppError } from "../../middleware/error-handler.js";
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

async function lockFolder(client: ImapFlow, folder: string) {
  try {
    return await client.getMailboxLock(folder, { readOnly: true });
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
