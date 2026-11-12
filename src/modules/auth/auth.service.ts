import type { Request } from "express";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { getSessionToken } from "../../lib/cookies.js";
import { encrypt, generateToken, hashToken } from "../../lib/crypto.js";
import { MailServerUnavailableError, verifyImapLogin } from "../../lib/imap.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { isCompanyEmail } from "./auth.schema.js";
import {
  assertNotThrottled,
  clearFailures,
  recordFailure,
} from "./login-throttle.js";

/** Konteks AAD untuk enkripsi password IMAP di sesi (jangan diubah setelah dipakai). */
export const CREDENTIAL_CONTEXT = "session-credential";

const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Email atau password salah");

export interface LoginResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  twoFactorRequired: boolean;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "ADMIN" | "USER";
  };
}

export async function login(
  req: Request,
  email: string,
  password: string,
): Promise<LoginResult> {
  const ip = req.ip ?? "unknown";
  await assertNotThrottled(email, ip);

  if (!isCompanyEmail(email)) {
    await recordFailure(email, ip);
    await writeAudit(req, {
      action: "LOGIN_FAILED",
      targetEmail: email,
      metadata: { reason: "domain" },
    });
    throw invalidCredentials();
  }

  let verdict: Awaited<ReturnType<typeof verifyImapLogin>>;
  try {
    verdict = await verifyImapLogin(email, password);
  } catch (err) {
    if (err instanceof MailServerUnavailableError) {
      req.log.error({ err }, "mail server tidak dapat dihubungi saat login");
      throw new AppError(
        503,
        "MAIL_SERVER_UNAVAILABLE",
        "Mail server sedang tidak dapat dihubungi. Coba lagi nanti.",
      );
    }
    throw err;
  }

  if (verdict !== "ok") {
    await recordFailure(email, ip);
    await writeAudit(req, {
      action: "LOGIN_FAILED",
      targetEmail: email,
      metadata: { reason: "credentials" },
    });
    throw invalidCredentials();
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.isActive) {
    await writeAudit(req, {
      actorId: existing.id,
      action: "LOGIN_BLOCKED",
      targetEmail: email,
      metadata: { reason: "inactive" },
    });
    throw new AppError(
      403,
      "ACCOUNT_DISABLED",
      "Akun dinonaktifkan. Hubungi administrator.",
    );
  }

  const role = env.ADMIN_EMAILS.includes(email) ? "ADMIN" : "USER";
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      displayName: email.split("@")[0] ?? email,
      role,
      lastLoginAt: now,
    },
    update: { role, lastLoginAt: now },
  });
  await clearFailures(email);

  const sessionToken = generateToken();
  const csrfToken = generateToken();
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_HOURS * 3_600_000);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      credentialEnc: encrypt(password, CREDENTIAL_CONTEXT),
      twoFactorVerified: !user.twoFactorEnabled,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
      expiresAt,
    },
  });

  await writeAudit(req, {
    actorId: user.id,
    action: "LOGIN_SUCCESS",
    targetEmail: email,
  });

  return {
    sessionToken,
    csrfToken,
    expiresAt,
    twoFactorRequired: user.twoFactorEnabled,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  };
}

/** Idempotent: aman dipanggil walau sesi sudah berakhir atau tidak ada. */
export async function logout(req: Request): Promise<void> {
  const token = getSessionToken(req);
  if (!token) return;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session || session.revokedAt !== null) return;

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  await writeAudit(req, { actorId: session.userId, action: "LOGOUT" });
}
