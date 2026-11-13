import { ImapFlow } from "imapflow";
import { env } from "../config/env.js";
import { AppError } from "../middleware/error-handler.js";
import { CREDENTIAL_CONTEXT } from "../modules/auth/auth.service.js";
import { decrypt } from "./crypto.js";
import { isAuthFailure } from "./imap.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

/**
 * Membuka satu koneksi IMAP atas nama user yang sedang login, menjalankan `fn`,
 * lalu menutup koneksi. Password IMAP didekripsi dari sesi hanya selama pemanggilan ini.
 */
export function decryptCredential(auth: Express.AuthContext): string {
  try {
    return decrypt(auth.credentialEnc, CREDENTIAL_CONTEXT);
  } catch {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sesi tidak valid atau sudah berakhir",
    );
  }
}

/**
 * Mencabut sesi saat server mail menolak password tersimpan (biasanya password
 * diganti di tempat lain). Tanpa ini, tiap permintaan mengulang login yang gagal.
 */
export async function revokeSessionForBadCredential(
  auth: Express.AuthContext,
): Promise<void> {
  try {
    await prisma.session.updateMany({
      where: { id: auth.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    logger.warn({ err }, "gagal mencabut sesi dengan kredensial tidak valid");
  }
}

export async function withMailbox<T>(
  auth: Express.AuthContext,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const password = decryptCredential(auth);

  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    auth: { user: auth.user.email, pass: password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => {
    // Error ditangani lewat promise; listener ini mencegah proses crash.
  });

  try {
    try {
      await client.connect();
    } catch (err) {
      if (isAuthFailure(err)) {
        await revokeSessionForBadCredential(auth);
        throw new AppError(
          401,
          "MAIL_CREDENTIAL_INVALID",
          "Password email sudah berubah. Silakan login ulang.",
        );
      }
      logger.error({ err }, "gagal menyambung ke mail server");
      throw new AppError(
        503,
        "MAIL_SERVER_UNAVAILABLE",
        "Mail server sedang tidak dapat dihubungi. Coba lagi nanti.",
      );
    }
    return await fn(client);
  } finally {
    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    }
  }
}
