import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const encryptionKey = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "hex");
const hmacKey = Buffer.from(env.SESSION_SECRET, "hex");

/**
 * Format keluaran: v1:<iv>:<authTag>:<ciphertext> (base64url).
 * `context` ikut diautentikasi (AAD) sehingga data terenkripsi dari satu
 * kolom tidak bisa dipindahkan ke kolom lain, mis. "session-credential".
 */
export function encrypt(plaintext: string, context = ""): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decrypt(payload: string, context = ""): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Format data terenkripsi tidak dikenali");
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Format data terenkripsi tidak dikenali");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("Gagal mendekripsi data");
  }
}

/** Token acak untuk cookie sesi dan CSRF (base64url, 43 karakter untuk 32 byte). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash token untuk disimpan di database (HMAC-SHA256 dengan SESSION_SECRET). */
export function hashToken(token: string): string {
  return createHmac("sha256", hmacKey).update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
