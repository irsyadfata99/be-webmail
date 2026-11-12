import type { Request, RequestHandler } from "express";
import { getSessionToken } from "../lib/cookies.js";
import { hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "./error-handler.js";

const TOUCH_INTERVAL_MS = 60_000;

const unauthorized = () =>
  new AppError(401, "UNAUTHORIZED", "Sesi tidak valid atau sudah berakhir");

async function resolveSession(req: Request): Promise<Express.AuthContext> {
  const token = getSessionToken(req);
  if (!token) throw unauthorized();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  const now = new Date();
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    !session.user.isActive
  ) {
    throw unauthorized();
  }

  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }

  return {
    sessionId: session.id,
    credentialEnc: session.credentialEnc,
    csrfTokenHash: session.csrfTokenHash,
    twoFactorVerified: session.twoFactorVerified,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
      twoFactorEnabled: session.user.twoFactorEnabled,
    },
  };
}

/** Memuat sesi tanpa memaksa 2FA (untuk /me, logout, dan verifikasi 2FA). */
export const authenticate: RequestHandler = async (req, _res, next) => {
  req.auth = await resolveSession(req);
  next();
};

/** Sesi valid, dan 2FA sudah diverifikasi bila akun mengaktifkannya. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const auth = await resolveSession(req);
  if (auth.user.twoFactorEnabled && !auth.twoFactorVerified) {
    throw new AppError(403, "TWO_FACTOR_REQUIRED", "Verifikasi 2FA diperlukan");
  }
  req.auth = auth;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "Akses ditolak");
  }
  next();
};
