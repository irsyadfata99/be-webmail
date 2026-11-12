import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env.js";

const production = env.NODE_ENV === "production";

export const SESSION_COOKIE = production ? "__Host-sid" : "sid";
export const CSRF_COOKIE = "csrf_token";

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

const base = (): CookieOptions => ({
  secure: env.COOKIE_SECURE,
  sameSite: "lax",
  path: "/",
});

export function setAuthCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE, sessionToken, {
    ...base(),
    httpOnly: true,
    expires: expiresAt,
  });
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base(),
    httpOnly: false,
    expires: expiresAt,
    domain: env.COOKIE_DOMAIN,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...base(), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, {
    ...base(),
    httpOnly: false,
    domain: env.COOKIE_DOMAIN,
  });
}
