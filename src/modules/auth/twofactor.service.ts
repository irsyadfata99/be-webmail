import type { Request } from "express";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { decrypt, encrypt, hashToken } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { generateSecret, otpauthUri, verifyTotp } from "../../lib/totp.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  assertNotThrottled,
  clearFailures,
  recordFailure,
} from "./login-throttle.js";
import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "./twofactor.codes.js";
import type { FactorInput } from "./twofactor.schema.js";

/** Konteks AAD untuk enkripsi rahasia TOTP (jangan diubah setelah dipakai). */
export const TOTP_CONTEXT = "totp-secret";

interface UserRecord {
  id: string;
  email: string;
  twoFactorEnabled: boolean;
  totpSecretEnc: string | null;
  totpLastStep: number | null;
}

type Method = "totp" | "recovery";

async function loadUser(userId: string): Promise<UserRecord> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sesi tidak valid atau sudah berakhir",
    );
  }
  return user;
}

const recoveryRows = (userId: string, codes: string[]) =>
  codes.map((c) => ({
    userId,
    codeHash: hashToken(normalizeRecoveryCode(c)),
  }));

async function countRecoveryLeft(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}

/** Mengklaim kode TOTP: benar, dan belum pernah dipakai (langkahnya dicatat). */
async function claimTotp(user: UserRecord, code: string): Promise<boolean> {
  if (!user.totpSecretEnc) return false;
  const secret = decrypt(user.totpSecretEnc, TOTP_CONTEXT);
  const step = verifyTotp(secret, code, Date.now(), {
    lastStep: user.totpLastStep,
  });
  if (step === null) return false;
  // Pembaruan bersyarat: dua permintaan serentak dengan kode yang sama, hanya satu yang lolos.
  const { count } = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
    },
    data: { totpLastStep: step },
  });
  return count === 1;
}

/** Mengklaim kode pemulihan: cocok dan belum terpakai (sekali pakai). */
async function claimRecovery(
  userId: string,
  recoveryCode: string,
): Promise<boolean> {
  const { count } = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash: hashToken(recoveryCode), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/** Memeriksa faktor kedua dengan pembatasan percobaan; 401 bila salah. */
async function checkSecondFactor(
  req: Request,
  user: UserRecord,
  input: FactorInput,
): Promise<Method> {
  const key = `2fa:${user.email}`;
  const ip = req.ip ?? "unknown";
  await assertNotThrottled(key, ip);

  const method: Method = input.code !== undefined ? "totp" : "recovery";
  const ok =
    input.code !== undefined
      ? await claimTotp(user, input.code)
      : await claimRecovery(user.id, input.recoveryCode ?? "");

  if (!ok) {
    await recordFailure(key, ip);
    await writeAudit(req, {
      actorId: user.id,
      action: "TWO_FACTOR_FAILED",
      targetEmail: user.email,
      metadata: { method },
    });
    throw new AppError(
      401,
      "INVALID_TWO_FACTOR_CODE",
      "Kode tidak valid atau sudah dipakai",
    );
  }
  await clearFailures(key);
  return method;
}

export async function getStatus(
  auth: Express.AuthContext,
): Promise<{
  enabled: boolean;
  pendingSetup: boolean;
  recoveryCodesLeft: number;
}> {
  const user = await loadUser(auth.user.id);
  return {
    enabled: user.twoFactorEnabled,
    pendingSetup: !user.twoFactorEnabled && user.totpSecretEnc !== null,
    recoveryCodesLeft: user.twoFactorEnabled
      ? await countRecoveryLeft(user.id)
      : 0,
  };
}

/** Langkah 1: membuat rahasia baru (menimpa yang belum diaktifkan) untuk dipindai. */
export async function beginSetup(
  req: Request,
  auth: Express.AuthContext,
): Promise<{ secret: string; otpauthUri: string }> {
  const user = await loadUser(auth.user.id);
  if (user.twoFactorEnabled) {
    throw new AppError(409, "TWO_FACTOR_ALREADY_ENABLED", "2FA sudah aktif");
  }
  const secret = generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: encrypt(secret, TOTP_CONTEXT), totpLastStep: null },
  });
  await writeAudit(req, {
    actorId: user.id,
    action: "TWO_FACTOR_SETUP_STARTED",
    targetEmail: user.email,
  });
  return {
    secret,
    otpauthUri: otpauthUri({
      secret,
      account: user.email,
      issuer: env.MAIL_DOMAIN,
    }),
  };
}

/** Langkah 2: kode pertama benar, 2FA aktif, kode pemulihan dibuat, sesi lain dicabut. */
export async function enableTwoFactor(
  req: Request,
  auth: Express.AuthContext,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const user = await loadUser(auth.user.id);
  if (user.twoFactorEnabled) {
    throw new AppError(409, "TWO_FACTOR_ALREADY_ENABLED", "2FA sudah aktif");
  }
  if (!user.totpSecretEnc) {
    throw new AppError(
      400,
      "TWO_FACTOR_NOT_STARTED",
      "Mulai pemasangan 2FA terlebih dahulu",
    );
  }

  const key = `2fa:${user.email}`;
  const ip = req.ip ?? "unknown";
  await assertNotThrottled(key, ip);

  const step = verifyTotp(
    decrypt(user.totpSecretEnc, TOTP_CONTEXT),
    code,
    Date.now(),
  );
  if (step === null) {
    await recordFailure(key, ip);
    await writeAudit(req, {
      actorId: user.id,
      action: "TWO_FACTOR_FAILED",
      targetEmail: user.email,
      metadata: { method: "totp", stage: "enable" },
    });
    throw new AppError(
      401,
      "INVALID_TWO_FACTOR_CODE",
      "Kode tidak valid atau sudah dipakai",
    );
  }
  await clearFailures(key);

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, totpLastStep: step },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({
      data: recoveryRows(user.id, recoveryCodes),
    }),
    // Sesi ini baru saja membuktikan kode 2FA, jadi langsung dianggap terverifikasi.
    prisma.session.update({
      where: { id: auth.sessionId },
      data: { twoFactorVerified: true },
    }),
    // Sesi lain dibuat saat 2FA belum aktif; paksa login ulang dengan 2FA.
    prisma.session.updateMany({
      where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await writeAudit(req, {
    actorId: user.id,
    action: "TWO_FACTOR_ENABLED",
    targetEmail: user.email,
  });
  return { recoveryCodes };
}

/** Setelah login: menandai sesi ini sudah lolos 2FA. Idempoten. */
export async function verifyLogin(
  req: Request,
  auth: Express.AuthContext,
  input: FactorInput,
): Promise<{
  verified: true;
  method: Method | null;
  recoveryCodesLeft: number;
}> {
  const user = await loadUser(auth.user.id);
  if (!user.twoFactorEnabled) {
    throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "2FA belum aktif");
  }
  if (auth.twoFactorVerified) {
    return {
      verified: true,
      method: null,
      recoveryCodesLeft: await countRecoveryLeft(user.id),
    };
  }

  const method = await checkSecondFactor(req, user, input);
  await prisma.session.update({
    where: { id: auth.sessionId },
    data: { twoFactorVerified: true },
  });
  await writeAudit(req, {
    actorId: user.id,
    action: "TWO_FACTOR_VERIFIED",
    targetEmail: user.email,
    metadata: { method },
  });
  return {
    verified: true,
    method,
    recoveryCodesLeft: await countRecoveryLeft(user.id),
  };
}

export async function disableTwoFactor(
  req: Request,
  auth: Express.AuthContext,
  input: FactorInput,
): Promise<{ disabled: true }> {
  const user = await loadUser(auth.user.id);
  if (!user.twoFactorEnabled) {
    throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "2FA belum aktif");
  }
  await checkSecondFactor(req, user, input);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        totpSecretEnc: null,
        totpLastStep: null,
      },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  await writeAudit(req, {
    actorId: user.id,
    action: "TWO_FACTOR_DISABLED",
    targetEmail: user.email,
  });
  return { disabled: true };
}

/** Membuat ulang 10 kode pemulihan; yang lama tidak berlaku lagi. */
export async function regenerateRecoveryCodes(
  req: Request,
  auth: Express.AuthContext,
  input: FactorInput,
): Promise<{ recoveryCodes: string[] }> {
  const user = await loadUser(auth.user.id);
  if (!user.twoFactorEnabled) {
    throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "2FA belum aktif");
  }
  await checkSecondFactor(req, user, input);

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({
      data: recoveryRows(user.id, recoveryCodes),
    }),
  ]);
  await writeAudit(req, {
    actorId: user.id,
    action: "TWO_FACTOR_CODES_REGENERATED",
    targetEmail: user.email,
  });
  return { recoveryCodes };
}

/** Admin mematikan 2FA karyawan yang kehilangan ponsel; semua sesinya dicabut. */
export async function resetTwoFactorByAdmin(
  req: Request,
  actor: Express.AuthContext,
  email: string,
): Promise<{ email: string; sessionsRevoked: number }> {
  if (actor.user.email === email) {
    throw new AppError(
      400,
      "CANNOT_MODIFY_SELF",
      "Gunakan pengaturan 2FA Anda sendiri untuk mematikannya",
    );
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(
      404,
      "ACCOUNT_NOT_FOUND",
      "Akun belum pernah masuk ke webmail",
    );
  }

  const [, , revoked] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        totpSecretEnc: null,
        totpLastStep: null,
      },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await writeAudit(req, {
    actorId: actor.user.id,
    action: "ADMIN_TWO_FACTOR_RESET",
    targetEmail: email,
    metadata: { sessionsRevoked: revoked.count },
  });
  return { email, sessionsRevoked: revoked.count };
}
