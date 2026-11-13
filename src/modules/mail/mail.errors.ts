import { logger } from "../../lib/logger.js";
import { AppError } from "../../middleware/error-handler.js";

/** Memetakan galat SMTP (nodemailer) ke AppError yang aman ditampilkan ke pengguna. */
export function smtpError(err: unknown): AppError {
  const e = (err ?? {}) as { code?: string; responseCode?: number };

  if (e.code === "EAUTH") {
    return new AppError(
      401,
      "MAIL_CREDENTIAL_INVALID",
      "Password email sudah berubah. Silakan login ulang.",
    );
  }
  // 552: pesan melebihi batas ukuran server. Jangan dilaporkan sebagai salah alamat.
  if (e.responseCode === 552) {
    return new AppError(
      413,
      "MESSAGE_TOO_LARGE",
      "Ukuran pesan melebihi batas server. Kurangi ukuran lampiran.",
    );
  }
  if (e.code === "EENVELOPE" || (e.responseCode && e.responseCode >= 500)) {
    return new AppError(
      422,
      "RECIPIENT_REJECTED",
      "Pesan ditolak oleh mail server. Periksa alamat penerima.",
    );
  }
  logger.error({ err }, "gagal mengirim lewat SMTP");
  return new AppError(
    503,
    "MAIL_SERVER_UNAVAILABLE",
    "Mail server sedang tidak dapat dihubungi. Coba lagi nanti.",
  );
}
