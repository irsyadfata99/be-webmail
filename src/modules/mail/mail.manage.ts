import type { ImapFlow, SearchObject } from "imapflow";
import { withMailbox } from "../../lib/imap-session.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  hasCriteria,
  parseSearchQuery,
  toImapSearches,
  type ParsedSearch,
} from "./mail.search.js";
import type { FlagName, TargetRole } from "./mail.schema.js";
import { lockFolder, toSummary, type MessageSummary } from "./mail.service.js";
import {
  baseSubject,
  extractIds,
  parseReferencesHeader,
  selectThread,
  threadSearchCriteria,
  threadSearchIds,
  type ThreadMeta,
} from "./mail.thread.js";
import { folderRole, hasAttachment, type FolderRole } from "./mail.utils.js";

/**
 * Mengelola pesan: bendera, pindah, hapus, kosongkan folder, cari, dan thread.
 * Semua aksi massal idempoten: UID yang sudah tidak ada diabaikan oleh server.
 */

type Box = Awaited<ReturnType<ImapFlow["list"]>>[number];

export interface UidPair {
  from: number;
  to: number;
}

type FetchQuery = Parameters<ImapFlow["fetchOne"]>[1];

const FETCH_SUMMARY: FetchQuery = {
  uid: true,
  flags: true,
  envelope: true,
  internalDate: true,
  size: true,
  bodyStructure: true,
};

const MAX_MATCHES = 2000;
const PER_FOLDER_ALL = 100;
const MAX_ALL_RESULTS = 200;
const MAX_ALL_FOLDERS = 20;
const ATTACHMENT_CHUNK = 200;
const THREAD_PER_FOLDER = 100;

function folderNotFound(): AppError {
  return new AppError(404, "FOLDER_NOT_FOUND", "Folder tidak ditemukan");
}

async function listBoxes(client: ImapFlow): Promise<Box[]> {
  const boxes = await client.list();
  return boxes.filter(
    (b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent"),
  );
}

function roleOf(box: Box): FolderRole {
  return folderRole(box.path, box.specialUse, box.name);
}

const ROLE_FOR_TARGET: Record<TargetRole, FolderRole> = {
  inbox: "inbox",
  spam: "junk",
  trash: "trash",
  archive: "archive",
};

const DEFAULT_FOLDER_NAME: Partial<Record<FolderRole, string>> = {
  junk: "Junk",
  trash: "Trash",
  archive: "Archive",
};

/** Folder berperan tertentu; Trash, Spam, dan Archive dibuat bila belum ada. */
async function resolveRoleFolder(
  client: ImapFlow,
  boxes: Box[],
  role: FolderRole,
): Promise<string> {
  const found = boxes.find((b) => roleOf(b) === role);
  if (found) return found.path;
  if (role === "inbox") return "INBOX";

  const name = DEFAULT_FOLDER_NAME[role];
  if (!name) throw folderNotFound();
  try {
    await client.mailboxCreate(name);
  } catch (err) {
    const code = (err as { serverResponseCode?: string }).serverResponseCode;
    if (code !== "ALREADYEXISTS") {
      throw new AppError(
        409,
        "FOLDER_UNAVAILABLE",
        `Folder ${name} tidak ada dan tidak bisa dibuat`,
      );
    }
  }
  try {
    await client.mailboxSubscribe(name);
  } catch {
    // Berlangganan hanya memengaruhi tampilan di klien lain; abaikan bila gagal.
  }
  return name;
}

function toPairs(map: Map<number, number> | undefined): UidPair[] {
  return map ? [...map].map(([from, to]) => ({ from, to })) : [];
}

const range = (uids: readonly number[]): string => uids.join(",");

async function moveUids(
  client: ImapFlow,
  source: string,
  destination: string,
  uids: readonly number[],
): Promise<UidPair[]> {
  const lock = await lockFolder(client, source, false);
  try {
    const result = await client.messageMove(range(uids), destination, {
      uid: true,
    });
    return result ? toPairs(result.uidMap) : [];
  } finally {
    lock.release();
  }
}

// ---- Bendera ----

const IMAP_FLAG: Record<FlagName, string> = {
  seen: "\\Seen",
  flagged: "\\Flagged",
};

export async function updateFlags(
  auth: Express.AuthContext,
  folder: string,
  uids: readonly number[],
  add: readonly FlagName[],
  remove: readonly FlagName[],
): Promise<{ count: number }> {
  return withMailbox(auth, async (client) => {
    const lock = await lockFolder(client, folder, false);
    try {
      if (add.length > 0) {
        await client.messageFlagsAdd(
          range(uids),
          add.map((f) => IMAP_FLAG[f]),
          { uid: true },
        );
      }
      if (remove.length > 0) {
        await client.messageFlagsRemove(
          range(uids),
          remove.map((f) => IMAP_FLAG[f]),
          { uid: true },
        );
      }
      return { count: uids.length };
    } finally {
      lock.release();
    }
  });
}

// ---- Pindah ----

export interface MoveResult {
  moved: number;
  folder: string;
  /** UID lama ke UID baru; dipakai frontend untuk "Batalkan". */
  uidMap: UidPair[];
}

export async function moveMessages(
  auth: Express.AuthContext,
  folder: string,
  uids: readonly number[],
  target: { to?: string | undefined; toRole?: TargetRole | undefined },
): Promise<MoveResult> {
  return withMailbox(auth, async (client) => {
    const boxes = await listBoxes(client);
    const source = boxes.find((b) => b.path === folder);
    if (!source) throw folderNotFound();

    let destination: string;
    if (target.to !== undefined) {
      const box = boxes.find((b) => b.path === target.to);
      if (!box) throw folderNotFound();
      destination = box.path;
    } else if (target.toRole !== undefined) {
      destination = await resolveRoleFolder(
        client,
        boxes,
        ROLE_FOR_TARGET[target.toRole],
      );
    } else {
      throw new AppError(400, "VALIDATION_ERROR", "Tujuan tidak diisi");
    }

    if (destination === source.path) {
      throw new AppError(
        400,
        "SAME_FOLDER",
        "Folder tujuan sama dengan folder asal",
      );
    }
    const destBox = boxes.find((b) => b.path === destination);
    if (destBox && roleOf(destBox) === "drafts") {
      throw new AppError(
        400,
        "INVALID_TARGET",
        "Pesan tidak bisa dipindahkan ke Drafts",
      );
    }

    const uidMap = await moveUids(client, source.path, destination, uids);
    return { moved: uidMap.length, folder: destination, uidMap };
  });
}

// ---- Hapus ----

export interface DeleteResult {
  /** True bila pesan dihapus selamanya (dari Trash, Spam, atau Drafts). */
  permanent: boolean;
  count: number;
  /** Folder Trash tujuan bila tidak permanen. */
  folder: string | null;
  uidMap: UidPair[];
}

/**
 * Seperti Gmail: dari folder biasa pesan masuk Trash; dari Trash, Spam, atau
 * Drafts pesan dihapus selamanya.
 */
export async function deleteMessages(
  auth: Express.AuthContext,
  folder: string,
  uids: readonly number[],
): Promise<DeleteResult> {
  return withMailbox(auth, async (client) => {
    const boxes = await listBoxes(client);
    const source = boxes.find((b) => b.path === folder);
    if (!source) throw folderNotFound();

    const role = roleOf(source);
    if (role === "trash" || role === "junk" || role === "drafts") {
      const lock = await lockFolder(client, source.path, false);
      try {
        await client.messageDelete(range(uids), { uid: true });
      } finally {
        lock.release();
      }
      return { permanent: true, count: uids.length, folder: null, uidMap: [] };
    }

    const trash = await resolveRoleFolder(client, boxes, "trash");
    const uidMap = await moveUids(client, source.path, trash, uids);
    return {
      permanent: false,
      count: uidMap.length,
      folder: trash,
      uidMap,
    };
  });
}

/** Mengosongkan Trash atau Spam (hapus selamanya). */
export async function emptyFolder(
  auth: Express.AuthContext,
  folder: string,
): Promise<{ deleted: number }> {
  return withMailbox(auth, async (client) => {
    const boxes = await listBoxes(client);
    const box = boxes.find((b) => b.path === folder);
    if (!box) throw folderNotFound();
    const role = roleOf(box);
    if (role !== "trash" && role !== "junk") {
      throw new AppError(
        400,
        "FOLDER_NOT_EMPTYABLE",
        "Hanya folder Trash dan Spam yang bisa dikosongkan",
      );
    }

    const lock = await lockFolder(client, box.path, false);
    try {
      const mailbox = client.mailbox;
      const total = mailbox ? mailbox.exists : 0;
      if (total > 0) await client.messageDelete("1:*");
      return { deleted: total };
    } finally {
      lock.release();
    }
  });
}

// ---- Pencarian ----

export interface SearchHit extends MessageSummary {
  folder: string;
}

export interface SearchResult {
  q: string;
  scope: "folder" | "all";
  total: number;
  page: number;
  pageSize: number;
  /** True bila hasil dipotong oleh batas; persempit pencarian untuk hasil lengkap. */
  truncated: boolean;
  messages: SearchHit[];
}

async function searchUids(
  client: ImapFlow,
  query: SearchObject,
): Promise<number[]> {
  return (await client.search(query, { uid: true })) || [];
}

async function keepWithAttachments(
  client: ImapFlow,
  uids: readonly number[],
): Promise<number[]> {
  const keep = new Set<number>();
  for (let i = 0; i < uids.length; i += ATTACHMENT_CHUNK) {
    const chunk = uids.slice(i, i + ATTACHMENT_CHUNK);
    for await (const msg of client.fetch(
      range(chunk),
      { uid: true, bodyStructure: true },
      { uid: true },
    )) {
      if (hasAttachment(msg.bodyStructure)) keep.add(msg.uid);
    }
  }
  return uids.filter((uid) => keep.has(uid));
}

async function fetchSummaries(
  client: ImapFlow,
  uids: readonly number[],
): Promise<MessageSummary[]> {
  if (uids.length === 0) return [];
  const out: MessageSummary[] = [];
  for await (const msg of client.fetch(range(uids), FETCH_SUMMARY, {
    uid: true,
  })) {
    out.push(toSummary(msg));
  }
  return out.sort((a, b) => b.uid - a.uid);
}

/** Mencari di satu folder; `pick` memilih UID (terbaru dulu) yang diambil ringkasannya. */
async function searchFolder(
  client: ImapFlow,
  folder: string,
  parsed: ParsedSearch,
  pick: (uids: number[]) => number[],
): Promise<{ total: number; truncated: boolean; summaries: MessageSummary[] }> {
  const lock = await lockFolder(client, folder);
  try {
    const searches = toImapSearches(parsed);
    let matched: Set<number>;
    if (searches.length === 0) {
      matched = new Set(await searchUids(client, { all: true }));
    } else {
      let acc = undefined as Set<number> | undefined;
      for (const search of searches) {
        const found = new Set(await searchUids(client, search));
        const previous: Set<number> | undefined = acc;
        acc = previous
          ? new Set([...previous].filter((u) => found.has(u)))
          : found;
        if (acc.size === 0) break;
      }
      matched = acc ?? new Set();
    }

    let uids = [...matched].sort((a, b) => b - a);
    let truncated = false;
    if (uids.length > MAX_MATCHES) {
      uids = uids.slice(0, MAX_MATCHES);
      truncated = true;
    }
    if (parsed.hasAttachment) uids = await keepWithAttachments(client, uids);

    return {
      total: uids.length,
      truncated,
      summaries: await fetchSummaries(client, pick(uids)),
    };
  } finally {
    lock.release();
  }
}

export async function searchMessages(
  auth: Express.AuthContext,
  q: string,
  folder: string,
  scope: "folder" | "all",
  page: number,
  pageSize: number,
): Promise<SearchResult> {
  const parsed = parseSearchQuery(q);
  if (!hasCriteria(parsed)) {
    throw new AppError(400, "SEARCH_EMPTY", "Kata kunci pencarian kosong");
  }

  return withMailbox(auth, async (client) => {
    if (scope === "folder") {
      const start = (page - 1) * pageSize;
      const found = await searchFolder(client, folder, parsed, (uids) =>
        uids.slice(start, start + pageSize),
      );
      return {
        q,
        scope,
        total: found.total,
        page,
        pageSize,
        truncated: found.truncated,
        messages: found.summaries.map((m) => ({ ...m, folder })),
      };
    }

    // Semua folder kecuali Trash dan Spam, seperti Gmail.
    const boxes = (await listBoxes(client)).filter((b) => {
      const role = roleOf(b);
      return role !== "trash" && role !== "junk";
    });
    let truncated = boxes.length > MAX_ALL_FOLDERS;
    const hits: SearchHit[] = [];
    for (const box of boxes.slice(0, MAX_ALL_FOLDERS)) {
      const found = await searchFolder(client, box.path, parsed, (uids) =>
        uids.slice(0, PER_FOLDER_ALL),
      );
      if (found.truncated || found.total > PER_FOLDER_ALL) truncated = true;
      hits.push(...found.summaries.map((m) => ({ ...m, folder: box.path })));
    }

    hits.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (hits.length > MAX_ALL_RESULTS) truncated = true;
    const capped = hits.slice(0, MAX_ALL_RESULTS);
    const start = (page - 1) * pageSize;
    return {
      q,
      scope,
      total: capped.length,
      page,
      pageSize,
      truncated,
      messages: capped.slice(start, start + pageSize),
    };
  });
}

// ---- Thread ----

export interface ThreadMessage extends MessageSummary {
  folder: string;
  messageId: string | null;
  inReplyTo: string | null;
}

export interface ThreadResult {
  subject: string;
  count: number;
  messages: ThreadMessage[];
}

interface ThreadEntry extends ThreadMeta {
  summary: MessageSummary;
}

const FETCH_THREAD: FetchQuery = { ...FETCH_SUMMARY, headers: ["references"] };

function toEntry(
  folder: string,
  msg: Parameters<typeof toSummary>[0],
): ThreadEntry {
  return {
    folder,
    uid: msg.uid,
    messageId: extractIds(msg.envelope?.messageId)[0] ?? null,
    inReplyTo: extractIds(msg.envelope?.inReplyTo)[0] ?? null,
    references: parseReferencesHeader(msg.headers),
    summary: toSummary(msg),
  };
}

export async function getThread(
  auth: Express.AuthContext,
  folder: string,
  uid: number,
): Promise<ThreadResult> {
  return withMailbox(auth, async (client) => {
    // Pesan yang dibuka menjadi benih percakapan.
    const seedLock = await lockFolder(client, folder);
    let seed: ThreadEntry;
    try {
      const msg = await client.fetchOne(String(uid), FETCH_THREAD, {
        uid: true,
      });
      if (!msg) {
        throw new AppError(404, "MESSAGE_NOT_FOUND", "Pesan tidak ditemukan");
      }
      seed = toEntry(folder, msg);
    } finally {
      seedLock.release();
    }

    const criteria = threadSearchCriteria(threadSearchIds(seed));
    const candidates: ThreadEntry[] = [];
    if (criteria) {
      // Folder asal, Inbox, Sent, dan Archive: balasan Anda ikut muncul.
      const boxes = await listBoxes(client);
      const paths = new Set<string>([folder]);
      for (const role of ["inbox", "sent", "archive"] as const) {
        const box = boxes.find((b) => roleOf(b) === role);
        if (box) paths.add(box.path);
      }
      for (const path of paths) {
        const lock = await lockFolder(client, path);
        try {
          const found = (await searchUids(client, criteria))
            .sort((a, b) => b - a)
            .slice(0, THREAD_PER_FOLDER);
          if (found.length === 0) continue;
          for await (const msg of client.fetch(range(found), FETCH_THREAD, {
            uid: true,
          })) {
            candidates.push(toEntry(path, msg));
          }
        } finally {
          lock.release();
        }
      }
    }

    const messages = selectThread(seed, candidates)
      .map((e) => ({
        ...e.summary,
        folder: e.folder,
        messageId: e.messageId,
        inReplyTo: e.inReplyTo,
      }))
      .sort(
        (a, b) =>
          (a.date ?? "").localeCompare(b.date ?? "") ||
          a.folder.localeCompare(b.folder) ||
          a.uid - b.uid,
      );

    return {
      subject: baseSubject(seed.summary.subject),
      count: messages.length,
      messages,
    };
  });
}
