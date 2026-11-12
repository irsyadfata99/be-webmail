import { ImapFlow } from "imapflow";
import { env } from "../config/env.js";

export type ImapVerifyResult = "ok" | "invalid_credentials";

export class MailServerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Mail server tidak dapat dihubungi", { cause });
    this.name = "MailServerUnavailableError";
  }
}

export function isAuthFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    authenticationFailed?: boolean;
    serverResponseCode?: string;
  };
  return (
    e.authenticationFailed === true ||
    e.serverResponseCode === "AUTHENTICATIONFAILED"
  );
}

/** Memverifikasi email dan password lewat login IMAP, lalu langsung logout. */
export async function verifyImapLogin(
  email: string,
  password: string,
): Promise<ImapVerifyResult> {
  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
  client.on("error", () => {
    // Error ditangani lewat promise connect(); listener ini mencegah crash.
  });

  try {
    await client.connect();
    return "ok";
  } catch (err) {
    if (isAuthFailure(err)) return "invalid_credentials";
    throw new MailServerUnavailableError(err);
  } finally {
    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    }
  }
}
