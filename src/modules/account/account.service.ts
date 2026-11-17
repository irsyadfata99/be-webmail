import type { Request } from "express";
import { writeAudit } from "../../lib/audit.js";
import { encrypt } from "../../lib/crypto.js";
import { MailServerUnavailableError, verifyImapLogin } from "../../lib/imap.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import type { AgentApi } from "../admin/agent.client.js";
import { CREDENTIAL_CONTEXT } from "../auth/auth.service.js";
import {
  assertNotThrottled,
  clearFailures,
  recordFailure,
} from "../auth/login-throttle.js";
import type { PasswordChangeBody, ProfileBody } from "./account.schema.js";

export interface ProfileView {
  email: string;
  displayName: string;
  signature: string | null;
  role: "ADMIN" | "USER";
  twoFactorEnabled: boolean;
}

function toView(user: {
  email: string;
  displayName: string;
  signature: string | null;
  role: "ADMIN" | "USER";
  twoFactorEnabled: boolean;
}): ProfileView {
  return {
    email: user.email,
    displayName: user.displayName,
    signature: user.signature,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

export async function getProfile(
  auth: Express.AuthContext,
): Promise<ProfileView> {
  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sesi tidak valid atau sudah berakhir",
    );
  }
  return toView(user);
}

/** Mengubah nama tampilan dan/atau tanda tangan milik sendiri. */
export async function updateProfile(
  req: Request,
  auth: Express.AuthContext,
  body: ProfileBody,
): Promise<ProfileView> {
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {}),
      ...(body.signature !== undefined ? { signature: body.signature } : {}),
    },
  });
  await writeAudit(req, {
    actorId: user.id,
    action: "PROFILE_UPDATED",
    targetEmail: user.email,
    metadata: {
      displayName: body.displayName !== undefined,
      signature: body.signature !== undefined,
    },
  });
  return toView(user);
}

/**
 * Mengganti password sendiri. Password lama diverifikasi lewat login IMAP, password baru
 * ditulis oleh layanan akun. Sesi ini diperbarui agar tetap login; sesi lain dicabut
 * karena masih menyimpan password lama.
 */
export async function changePassword(
  req: Request,
  auth: Express.AuthContext,
  agent: AgentApi,
  body: PasswordChangeBody,
): Promise<{ sessionsRevoked: number }> {
  const email = auth.user.email;
  const key = `pw:${email}`;
  const ip = req.ip ?? "unknown";
  await assertNotThrottled(key, ip);

  let verdict: Awaited<ReturnType<typeof verifyImapLogin>>;
  try {
    verdict = await verifyImapLogin(email, body.currentPassword);
  } catch (err) {
    if (err instanceof MailServerUnavailableError) {
      throw new AppError(
        503,
        "MAIL_SERVER_UNAVAILABLE",
        "Mail server sedang tidak dapat dihubungi. Coba lagi nanti.",
      );
    }
    throw err;
  }
  if (verdict !== "ok") {
    await recordFailure(key, ip);
    await writeAudit(req, {
      actorId: auth.user.id,
      action: "PASSWORD_CHANGE_FAILED",
      targetEmail: email,
    });
    throw new AppError(
      400,
      "INVALID_CURRENT_PASSWORD",
      "Password saat ini salah",
    );
  }

  // Bila agent gagal, tidak ada yang berubah (password lama tetap berlaku).
  await agent.setPassword(email, body.newPassword);
  await clearFailures(key);

  const [, revoked] = await prisma.$transaction([
    prisma.session.update({
      where: { id: auth.sessionId },
      data: { credentialEnc: encrypt(body.newPassword, CREDENTIAL_CONTEXT) },
    }),
    prisma.session.updateMany({
      where: {
        userId: auth.user.id,
        revokedAt: null,
        id: { not: auth.sessionId },
      },
      data: { revokedAt: new Date() },
    }),
  ]);
  await writeAudit(req, {
    actorId: auth.user.id,
    action: "PASSWORD_CHANGED",
    targetEmail: email,
    metadata: { sessionsRevoked: revoked.count },
  });
  return { sessionsRevoked: revoked.count };
}
