import { randomInt } from "node:crypto";

/** Tanpa i, l, o, 0, 1 agar tidak tertukar saat disalin dari kertas. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_PATTERN = /^[a-z0-9]{10}$/;

/** Satu kode pemulihan, ditampilkan seperti `abcde-fghjk`. */
export function generateRecoveryCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Huruf kecil tanpa tanda hubung dan spasi; bentuk inilah yang di-hash. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]/g, "");
}
