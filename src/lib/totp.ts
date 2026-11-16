import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** TOTP (RFC 6238) dengan HMAC-SHA1, 6 digit, langkah 30 detik: cocok dengan aplikasi autentikator umum. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("Karakter base32 tidak valid");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** Rahasia acak 160 bit dalam base32 (32 karakter). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Kode HOTP (RFC 4226) untuk satu nilai penghitung. */
export function hotp(
  key: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", key).update(message).digest();
  const offset = hash[hash.length - 1]! & 0x0f;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    (hash[offset + 1]! << 16) |
    (hash[offset + 2]! << 8) |
    hash[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function stepAt(timeMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(timeMs / 1000 / period);
}

export function totpAt(
  secret: string,
  timeMs: number,
  digits = TOTP_DIGITS,
  period = TOTP_PERIOD_SECONDS,
): string {
  return hotp(base32Decode(secret), stepAt(timeMs, period), digits);
}

export interface VerifyOptions {
  /** Selisih langkah yang diterima ke dua arah (1 = ±30 detik, untuk jam yang sedikit meleset). */
  window?: number;
  /** Langkah terakhir yang sudah dipakai; kode dari langkah itu atau sebelumnya ditolak (anti pakai ulang). */
  lastStep?: number | null;
  digits?: number;
  period?: number;
}

/** Mengembalikan nomor langkah yang cocok, atau null bila kode salah atau sudah pernah dipakai. */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  options: VerifyOptions = {},
): number | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const period = options.period ?? TOTP_PERIOD_SECONDS;
  const window = options.window ?? 1;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null;

  const key = base32Decode(secret);
  const supplied = Buffer.from(code);
  const current = stepAt(nowMs, period);

  // Semua langkah diperiksa tanpa berhenti lebih awal agar waktu respons tidak bocor.
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(key, step, digits));
    if (timingSafeEqual(expected, supplied)) matched = step;
  }
  if (matched === null) return null;
  if (options.lastStep != null && matched <= options.lastStep) return null;
  return matched;
}

/** Alamat otpauth:// untuk kode QR di aplikasi autentikator. */
export function otpauthUri(opts: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
