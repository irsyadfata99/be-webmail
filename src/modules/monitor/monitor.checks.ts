import net from "node:net";
import tls from "node:tls";
import { prisma } from "../../lib/prisma.js";

export const CHECK_TIMEOUT_MS = 5_000;
const DAY_MS = 86_400_000;

export interface TlsInfo {
  /** true bila sertifikat dipercaya dan cocok dengan nama host. */
  authorized: boolean;
  daysLeft: number | null;
}

export interface Probe {
  up: boolean;
  ms: number | null;
  tls: TlsInfo | null;
  error: string | null;
}

/** Sisa hari sampai `validTo` (teks tanggal dari sertifikat); null bila tidak terbaca. */
export function daysUntil(
  validTo: string | undefined,
  now = Date.now(),
): number | null {
  if (!validTo) return null;
  const end = Date.parse(validTo);
  return Number.isNaN(end) ? null : Math.floor((end - now) / DAY_MS);
}

/** Menyambung ke host:port tanpa login; untuk TLS juga membaca masa berlaku sertifikat. */
export function probe(
  host: string,
  port: number,
  secure: boolean,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<Probe> {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (result: Omit<Probe, "ms">, socket: net.Socket): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ...result, ms: result.up ? Date.now() - started : null });
    };
    const fail = (socket: net.Socket, error: string): void =>
      finish({ up: false, tls: null, error }, socket);

    if (secure) {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        // Tetap tersambung bila sertifikat bermasalah agar masalahnya bisa dilaporkan.
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        finish(
          {
            up: true,
            error: null,
            tls: {
              authorized: socket.authorized,
              daysLeft: daysUntil(cert?.valid_to),
            },
          },
          socket,
        );
      });
      socket.once("timeout", () => fail(socket, "TIMEOUT"));
      socket.once("error", (err: NodeJS.ErrnoException) =>
        fail(socket, err.code ?? "ERROR"),
      );
    } else {
      const socket = net.connect({ host, port, timeout: timeoutMs });
      socket.once("connect", () =>
        finish({ up: true, tls: null, error: null }, socket),
      );
      socket.once("timeout", () => fail(socket, "TIMEOUT"));
      socket.once("error", (err: NodeJS.ErrnoException) =>
        fail(socket, err.code ?? "ERROR"),
      );
    }
  });
}

export interface Timed {
  up: boolean;
  ms: number | null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export async function checkDatabase(): Promise<Timed> {
  const started = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
    return { up: true, ms: Date.now() - started };
  } catch {
    return { up: false, ms: null };
  }
}

export type AgentState = "up" | "down" | "not_configured";

/** /health milik account-agent terbuka tanpa token, jadi kunci tidak ikut terkirim. */
export async function checkAgent(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: AgentState; ms: number | null }> {
  if (!url) return { status: "not_configured", ms: null };
  const started = Date.now();
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return res.ok
      ? { status: "up", ms: Date.now() - started }
      : { status: "down", ms: null };
  } catch {
    return { status: "down", ms: null };
  }
}
