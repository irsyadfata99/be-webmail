import type { SearchObject } from "imapflow";

/**
 * Pengelompokan percakapan dari header Message-ID, In-Reply-To, dan References.
 * Fungsi murni. IMAP THREAD tidak dipakai karena library tidak mendukungnya.
 */

export interface ThreadMeta {
  folder: string;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

const ID = /<[^<>\s]+>/g;

/** Semua Message-ID (dalam kurung sudut) dari nilai header, huruf kecil. */
export function extractIds(value: string | null | undefined): string[] {
  return (value?.match(ID) ?? []).map((id) => id.toLowerCase());
}

/** Membaca header References dari blok header mentah (boleh terlipat). */
export function parseReferencesHeader(
  block: Buffer | string | null | undefined,
): string[] {
  if (!block) return [];
  const text = (
    Buffer.isBuffer(block) ? block.toString("utf8") : block
  ).replace(/\r?\n[ \t]+/g, " ");
  const m = /^references:[ \t]*(.*)$/im.exec(text);
  return m ? extractIds(m[1]) : [];
}

const PREFIX = /^\s*(?:re|fwd?|fw|aw|sv|tr|wg|balas)(?:\[\d+\])?\s*:\s*/i;

/** Subjek tanpa awalan Re:, Fwd:, dan sejenisnya (huruf aslinya dipertahankan). */
export function baseSubject(subject: string): string {
  let s = subject;
  for (let i = 0; i < 10; i++) {
    const next = s.replace(PREFIX, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

/**
 * Message-ID yang dicari di server: akar percakapan (References pertama atau
 * In-Reply-To) dan pesan itu sendiri. Balasan selalu menyertakan akar di References.
 */
export function threadSearchIds(meta: ThreadMeta): string[] {
  const ids = [meta.references[0], meta.inReplyTo, meta.messageId].filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)];
}

export function threadSearchCriteria(ids: string[]): SearchObject | null {
  if (ids.length === 0) return null;
  return {
    or: ids.flatMap((id): SearchObject[] => [
      { header: { "message-id": id } },
      { header: { references: id } },
      { header: { "in-reply-to": id } },
    ]),
  };
}

function keyOf(m: ThreadMeta): string {
  return m.messageId ?? `${m.folder}\u0000${m.uid}`;
}

/**
 * Dari kandidat hasil pencarian server, ambil hanya yang terhubung dengan `seed`
 * (berbagi Message-ID, In-Reply-To, atau References). Pesan kembar (Message-ID sama,
 * mis. salinan Inbox dan Sent) digabung; yang pertama menang, dan `seed` selalu pertama.
 */
export function selectThread<T extends ThreadMeta>(
  seed: T,
  candidates: readonly T[],
): T[] {
  const seen = new Set<string>();
  const all: T[] = [];
  for (const m of [seed, ...candidates]) {
    const key = keyOf(m);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(m);
  }

  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const owner = new Map<string, number>();
  all.forEach((m, i) => {
    const tokens = [m.messageId, m.inReplyTo, ...m.references].filter(
      (t): t is string => Boolean(t),
    );
    for (const token of tokens) {
      const existing = owner.get(token);
      if (existing === undefined) owner.set(token, i);
      else union(i, existing);
    }
  });

  const seedRoot = find(0);
  return all.filter((_, i) => find(i) === seedRoot);
}
