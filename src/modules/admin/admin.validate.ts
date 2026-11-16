/** Aturan yang sama dengan layanan akun (agent/src/validate.ts); dicek di sini agar galat tertangkap sebelum memanggil agent. */
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const QUOTA = /^[1-9]\d{0,5}[MG]$/;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * Email huruf kecil bila valid dan berada di `domain`, selain itu null.
 * Bagian lokal saja ("budi") dilengkapi dengan domain.
 */
export function normalizeEmail(raw: unknown, domain: string): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (!value.includes("@")) value = `${value}@${domain}`;
  if (value.length > 254) return null;
  const parts = value.split("@");
  if (parts.length !== 2) return null;
  const [local, host] = parts as [string, string];
  if (host !== domain) return null;
  if (!LOCAL_PART.test(local) || local.includes("..")) return null;
  return `${local}@${host}`;
}

/** Pesan masalah bila password tidak memenuhi syarat, atau null bila boleh. */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string") return "password harus berupa teks";
  if (raw.length < PASSWORD_MIN)
    return `password minimal ${PASSWORD_MIN} karakter`;
  if (raw.length > PASSWORD_MAX)
    return `password maksimal ${PASSWORD_MAX} karakter`;
  if (/[\r\n\0]/.test(raw)) {
    return "password tidak boleh berisi baris baru atau karakter kosong";
  }
  return null;
}

export type QuotaInput = { ok: true; value: string | null } | { ok: false };

/** null menghapus kuota; selain itu bentuk seperti 500M atau 2G. */
export function parseQuota(raw: unknown): QuotaInput {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim().toUpperCase();
  return QUOTA.test(value) ? { ok: true, value } : { ok: false };
}
