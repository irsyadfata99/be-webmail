import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/** Mengambil token dari header `Authorization: Bearer <token>`; null bila bentuknya salah. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]{1,200})$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

/**
 * Membandingkan dengan semua kunci tanpa berhenti lebih awal. Keduanya di-hash dulu agar
 * panjangnya sama dan waktu respons tidak membocorkan isi kunci.
 */
export function matchesAnyKey(
  presented: string,
  keys: readonly string[],
): boolean {
  const candidate = digest(presented);
  let matched = false;
  for (const key of keys) {
    if (timingSafeEqual(candidate, digest(key))) matched = true;
  }
  return matched;
}

/** Hanya aplikasi monitoring yang memegang kunci; endpoint mati (404) bila tak ada kunci. */
export const requireMonitorKey: RequestHandler = (req, res, next) => {
  if (env.MONITOR_KEYS.length === 0) {
    throw new AppError(404, "NOT_FOUND", "Rute tidak ditemukan");
  }
  const token = bearerToken(req.get("authorization"));
  if (!token || !matchesAnyKey(token, env.MONITOR_KEYS)) {
    req.log.warn({ ip: req.ip }, "monitor: kunci API tidak ada atau salah");
    res.set("WWW-Authenticate", "Bearer");
    throw new AppError(401, "UNAUTHORIZED", "Kunci monitoring tidak valid");
  }
  next();
};
