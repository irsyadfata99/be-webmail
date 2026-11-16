import { randomBytes } from "node:crypto";
import { copyFile, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashPassword } from "./hash.ts";

export class StoreError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.code = code;
  }
}

export interface AccountInfo {
  email: string;
  quota: string | null;
  /** true bila akun dikunci: login IMAP/SMTP ditolak, hash asli disimpan terpisah. */
  disabled: boolean;
}

const ACCOUNTS_FILE = "postfix-accounts.cf";
const QUOTAS_FILE = "dovecot-quotas.cf";
/** Hash asli akun nonaktif, format `email|{SCHEME}hash`. Tidak dibaca docker-mailserver. */
const DISABLED_FILE = "webmail-disabled.cf";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  );
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return "";
    throw err;
  }
}

function toLines(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function fromLines(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Email pada baris `email|{SCHEME}hash`; null untuk komentar atau baris asing. */
function accountOf(line: string): string | null {
  if (line.trimStart().startsWith("#")) return null;
  const i = line.indexOf("|");
  if (i < 1) return null;
  return line.slice(0, i).trim().toLowerCase();
}

/** Bagian setelah `|` pada baris akun, yaitu `{SCHEME}hash`. */
function hashOf(line: string): string {
  return line.slice(line.indexOf("|") + 1).trim();
}

/** Email pada baris `email:kuota`; null untuk komentar atau baris asing. */
function quotaOf(line: string): string | null {
  if (line.trimStart().startsWith("#")) return null;
  const i = line.lastIndexOf(":");
  if (i < 1) return null;
  return line.slice(0, i).trim().toLowerCase();
}

function quotaValue(line: string): string {
  return line.slice(line.lastIndexOf(":") + 1).trim();
}

/**
 * Menulis berkas secara atomik: tulis ke berkas sementara di folder yang sama,
 * sync, lalu rename. Salinan versi sebelumnya disimpan sebagai `<nama>.bak`.
 */
async function writeAtomic(path: string, content: string): Promise<void> {
  let mode = 0o644;
  try {
    mode = (await stat(path)).mode & 0o777;
    await copyFile(path, `${path}.bak`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(tmp, "w", mode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

const notFound = () =>
  new StoreError(404, "ACCOUNT_NOT_FOUND", "Akun tidak ditemukan");

/**
 * Pengelola akun berbasis berkas konfigurasi docker-mailserver. Perubahan dideteksi
 * dan dimuat otomatis oleh docker-mailserver, tanpa akses ke Docker.
 * Semua penulisan diserialkan dalam satu antrean.
 */
export class AccountStore {
  #dir: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(configDir: string) {
    this.#dir = configDir;
  }

  #path(name: string): string {
    return join(this.#dir, name);
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<AccountInfo[]> {
    const [accounts, quotas, disabledText] = await Promise.all([
      readText(this.#path(ACCOUNTS_FILE)),
      readText(this.#path(QUOTAS_FILE)),
      readText(this.#path(DISABLED_FILE)),
    ]);

    const disabled = new Set<string>();
    for (const line of toLines(disabledText)) {
      const email = accountOf(line);
      if (email) disabled.add(email);
    }

    const quotaByEmail = new Map<string, string>();
    for (const line of toLines(quotas)) {
      const email = quotaOf(line);
      if (email) quotaByEmail.set(email, quotaValue(line));
    }

    const result: AccountInfo[] = [];
    for (const line of toLines(accounts)) {
      const email = accountOf(line);
      if (email) {
        result.push({
          email,
          quota: quotaByEmail.get(email) ?? null,
          disabled: disabled.has(email),
        });
      }
    }
    return result.sort((a, b) => a.email.localeCompare(b.email));
  }

  async create(email: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.#serial(async () => {
      const path = this.#path(ACCOUNTS_FILE);
      const lines = toLines(await readText(path));
      if (lines.some((l) => accountOf(l) === email)) {
        throw new StoreError(409, "ACCOUNT_EXISTS", "Akun sudah ada");
      }
      await this.#dropDisabled(email);
      lines.push(`${email}|{SHA512-CRYPT}${hash}`);
      await writeAtomic(path, fromLines(lines));
    });
  }

  async setPassword(email: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.#serial(async () => {
      const path = this.#path(ACCOUNTS_FILE);
      const lines = toLines(await readText(path));
      if (!lines.some((l) => accountOf(l) === email)) throw notFound();

      // Akun nonaktif tetap terkunci; password baru berlaku saat diaktifkan lagi.
      const disabledPath = this.#path(DISABLED_FILE);
      const disabledLines = toLines(await readText(disabledPath));
      if (disabledLines.some((l) => accountOf(l) === email)) {
        const updated = disabledLines.map((l) =>
          accountOf(l) === email ? `${email}|{SHA512-CRYPT}${hash}` : l,
        );
        await writeAtomic(disabledPath, fromLines(updated));
        return;
      }

      const next = lines.map((line) =>
        accountOf(line) === email ? `${email}|{SHA512-CRYPT}${hash}` : line,
      );
      await writeAtomic(path, fromLines(next));
    });
  }

  /** Menghapus akun dan kuotanya. Isi mailbox di disk tidak disentuh. */
  async remove(email: string): Promise<void> {
    await this.#serial(async () => {
      const accountsPath = this.#path(ACCOUNTS_FILE);
      const lines = toLines(await readText(accountsPath));
      const kept = lines.filter((l) => accountOf(l) !== email);
      if (kept.length === lines.length) throw notFound();
      await writeAtomic(accountsPath, fromLines(kept));
      await this.#dropDisabled(email);

      const quotasPath = this.#path(QUOTAS_FILE);
      const quotaLines = toLines(await readText(quotasPath));
      const quotaKept = quotaLines.filter((l) => quotaOf(l) !== email);
      if (quotaKept.length !== quotaLines.length) {
        await writeAtomic(quotasPath, fromLines(quotaKept));
      }
    });
  }

  /** Menghapus catatan hash asli akun nonaktif (bila ada). Dipanggil di dalam antrean. */
  async #dropDisabled(email: string): Promise<void> {
    const path = this.#path(DISABLED_FILE);
    const lines = toLines(await readText(path));
    const kept = lines.filter((l) => accountOf(l) !== email);
    if (kept.length !== lines.length) await writeAtomic(path, fromLines(kept));
  }

  /**
   * Mengunci atau membuka akun. Saat dikunci, hash asli disimpan di berkas
   * terpisah dan baris akun diganti hash dari rahasia acak yang tak diketahui
   * siapa pun, sehingga login IMAP dan SMTP gagal. Idempoten.
   */
  async setActive(email: string, active: boolean): Promise<void> {
    const lockHash = active
      ? ""
      : await hashPassword(randomBytes(32).toString("hex"));
    await this.#serial(async () => {
      const accountsPath = this.#path(ACCOUNTS_FILE);
      const accounts = toLines(await readText(accountsPath));
      const current = accounts.find((l) => accountOf(l) === email);
      if (!current) throw notFound();

      const disabledPath = this.#path(DISABLED_FILE);
      const disabledLines = toLines(await readText(disabledPath));
      const saved = disabledLines.find((l) => accountOf(l) === email);

      if (!active) {
        // Catatan ada dan hash akun sudah berbeda darinya: akun memang sudah terkunci.
        // Bila hash akun masih sama dengan catatan, percobaan mengunci sebelumnya terhenti
        // di tengah (langkah kedua gagal), jadi kunci tetap dipasang.
        if (saved && hashOf(saved) !== hashOf(current)) return;
        // Hash asli ditulis lebih dulu agar tidak pernah hilang bila langkah kedua gagal.
        if (!saved) {
          await writeAtomic(
            disabledPath,
            fromLines([...disabledLines, `${email}|${hashOf(current)}`]),
          );
        }
        await writeAtomic(
          accountsPath,
          fromLines(
            accounts.map((l) =>
              accountOf(l) === email ? `${email}|{SHA512-CRYPT}${lockHash}` : l,
            ),
          ),
        );
        return;
      }

      if (!saved) return;
      await writeAtomic(
        accountsPath,
        fromLines(
          accounts.map((l) =>
            accountOf(l) === email ? `${email}|${hashOf(saved)}` : l,
          ),
        ),
      );
      await writeAtomic(
        disabledPath,
        fromLines(disabledLines.filter((l) => accountOf(l) !== email)),
      );
    });
  }

  /** Mengatur kuota (mis. "2G"), atau menghapusnya bila null. */
  async setQuota(email: string, quota: string | null): Promise<void> {
    await this.#serial(async () => {
      const accounts = toLines(await readText(this.#path(ACCOUNTS_FILE)));
      if (!accounts.some((l) => accountOf(l) === email)) throw notFound();

      const quotasPath = this.#path(QUOTAS_FILE);
      const lines = toLines(await readText(quotasPath));
      const rest = lines.filter((l) => quotaOf(l) !== email);
      if (quota !== null) rest.push(`${email}:${quota}`);
      await writeAtomic(quotasPath, fromLines(rest));
    });
  }
}
