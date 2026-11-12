/** Fungsi murni untuk modul mail. Tidak menyentuh jaringan atau database. */

export type FolderRole =
  "inbox" | "drafts" | "sent" | "junk" | "trash" | "archive" | "other";

export interface FolderInfo {
  path: string;
  name: string;
  delimiter: string | null;
  role: FolderRole;
  messages: number;
  unseen: number;
  subscribed: boolean;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface StructureNode {
  disposition?: string | null;
  childNodes?: StructureNode[];
}

const SPECIAL_USE_ROLE: Record<string, FolderRole> = {
  "\\Inbox": "inbox",
  "\\Drafts": "drafts",
  "\\Sent": "sent",
  "\\Junk": "junk",
  "\\Trash": "trash",
  "\\Archive": "archive",
};

/** Cadangan bila server tidak mengumumkan atribut SPECIAL-USE. */
const NAME_ROLE: Record<string, FolderRole> = {
  drafts: "drafts",
  draft: "drafts",
  sent: "sent",
  "sent items": "sent",
  "sent messages": "sent",
  junk: "junk",
  spam: "junk",
  trash: "trash",
  "deleted items": "trash",
  "deleted messages": "trash",
  archive: "archive",
  archives: "archive",
};

const ROLE_ORDER: Record<FolderRole, number> = {
  inbox: 0,
  drafts: 1,
  sent: 2,
  junk: 3,
  trash: 4,
  archive: 5,
  other: 6,
};

export function folderRole(
  path: string,
  specialUse?: string | null,
  name?: string | null,
): FolderRole {
  if (path.toUpperCase() === "INBOX") return "inbox";
  if (specialUse) {
    const byAttribute = SPECIAL_USE_ROLE[specialUse];
    if (byAttribute) return byAttribute;
  }
  const byName = NAME_ROLE[(name ?? path).trim().toLowerCase()];
  return byName ?? "other";
}

/** INBOX dulu, lalu folder khusus (Drafts, Sent, Junk, Trash, Archive), lalu sisanya A-Z. */
export function sortFolders(folders: FolderInfo[]): FolderInfo[] {
  return [...folders].sort((a, b) => {
    const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (byRole !== 0) return byRole;
    return a.path.localeCompare(b.path, "id", { sensitivity: "base" });
  });
}

/**
 * Rentang nomor urut pesan untuk satu halaman, terbaru lebih dulu.
 * Halaman 1 adalah pesan dengan nomor urut tertinggi. Null bila halaman melewati batas.
 */
export function pageRange(
  total: number,
  page: number,
  pageSize: number,
): { low: number; high: number } | null {
  const high = total - (page - 1) * pageSize;
  if (high < 1) return null;
  return { low: Math.max(1, high - pageSize + 1), high };
}

/** Benar bila ada bagian MIME dengan disposition "attachment" di mana pun dalam pohon. */
export function hasAttachment(node: StructureNode | null | undefined): boolean {
  if (!node) return false;
  if (node.disposition?.toLowerCase() === "attachment") return true;
  return (node.childNodes ?? []).some((child) => hasAttachment(child));
}

export function toAddresses(
  list: ReadonlyArray<{ name?: string; address?: string }> | null | undefined,
): MailAddress[] {
  return (list ?? [])
    .filter((a) => Boolean(a.address))
    .map((a) => ({ name: a.name ?? "", address: a.address ?? "" }));
}

/** Tanggal pertama yang valid dalam format ISO, atau null. */
export function toIso(
  ...values: Array<Date | string | null | undefined>
): string | null {
  for (const value of values) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}
