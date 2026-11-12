import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { hashToken, safeEqual } from "../lib/crypto.js";
import { AppError } from "./error-handler.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set(env.CORS_ORIGIN.map((o) => new URL(o).origin));

/** Menolak request pengubah data dari origin browser yang tidak terdaftar. */
export const originGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    return next(
      new AppError(403, "ORIGIN_NOT_ALLOWED", "Origin tidak diizinkan"),
    );
  }
  next();
};

/** Dipasang setelah authenticate/requireAuth. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const header = req.get("x-csrf-token");
  const auth = req.auth;
  if (!auth || !header || !safeEqual(hashToken(header), auth.csrfTokenHash)) {
    return next(new AppError(403, "CSRF_INVALID", "Token CSRF tidak valid"));
  }
  next();
};
