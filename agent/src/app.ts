import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AgentConfig } from "./config.ts";
import { type AccountStore, StoreError } from "./store.ts";
import { normalizeEmail, parseQuota, passwordProblem } from "./validate.ts";

const MAX_BODY_BYTES = 10 * 1024;

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1] ?? ""), digest(token));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type harus application/json",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Data terlalu besar");
    }
    chunks.push(buf);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "BAD_JSON", "Format JSON tidak valid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "BAD_JSON", "Isi harus berupa objek JSON");
  }
  return parsed as Record<string, unknown>;
}

function emailParam(raw: string, domain: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "INVALID_EMAIL", "Email tidak valid");
  }
  const email = normalizeEmail(decoded, domain);
  if (!email) throw new HttpError(400, "INVALID_EMAIL", "Email tidak valid");
  return email;
}

function passwordField(body: Record<string, unknown>): string {
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, "INVALID_PASSWORD", problem);
  return body.password as string;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: AgentConfig,
  store: AccountStore,
): Promise<number> {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://agent").pathname;

  if (path === "/health" && method === "GET") {
    send(res, 200, { ok: true });
    return 200;
  }

  if (!isAuthorized(req, config.token)) {
    throw new HttpError(401, "UNAUTHORIZED", "Token tidak valid");
  }

  if (path === "/accounts") {
    if (method === "GET") {
      send(res, 200, { accounts: await store.list() });
      return 200;
    }
    if (method === "POST") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email, config.domain);
      if (!email)
        throw new HttpError(400, "INVALID_EMAIL", "Email tidak valid");
      await store.create(email, passwordField(body));
      send(res, 201, { email });
      return 201;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Metode tidak diizinkan");
  }

  const match = /^\/accounts\/([^/]+)(\/password|\/quota)?$/.exec(path);
  if (match) {
    const email = emailParam(match[1] ?? "", config.domain);
    const sub = match[2];

    if (sub === "/password") {
      if (method !== "PUT") {
        throw new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Metode tidak diizinkan",
        );
      }
      await store.setPassword(email, passwordField(await readJson(req)));
      send(res, 200, { email });
      return 200;
    }

    if (sub === "/quota") {
      if (method !== "PUT") {
        throw new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Metode tidak diizinkan",
        );
      }
      const body = await readJson(req);
      const quota = parseQuota(body.quota);
      if (!quota.ok) {
        throw new HttpError(
          400,
          "INVALID_QUOTA",
          "Kuota harus berbentuk seperti 500M atau 2G, atau null",
        );
      }
      await store.setQuota(email, quota.value);
      send(res, 200, { email, quota: quota.value });
      return 200;
    }

    if (method === "DELETE") {
      await store.remove(email);
      send(res, 200, { email });
      return 200;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Metode tidak diizinkan");
  }

  throw new HttpError(404, "NOT_FOUND", "Rute tidak ditemukan");
}

export function createAgentApp(
  config: AgentConfig,
  store: AccountStore,
): Server {
  const server = createServer((req, res) => {
    const started = Date.now();
    route(req, res, config, store)
      .then((status) => log(req, status, started))
      .catch((err: unknown) => {
        let status = 500;
        let code = "INTERNAL_ERROR";
        let message = "Terjadi kesalahan pada layanan";
        if (err instanceof HttpError || err instanceof StoreError) {
          status = err.status;
          code = err.code;
          message = err.message;
        } else {
          console.error(
            JSON.stringify({
              level: "error",
              msg: "kesalahan tak terduga",
              error: String(err),
            }),
          );
        }
        if (status === 413) res.setHeader("Connection", "close");
        if (!res.headersSent) send(res, status, { error: { code, message } });
        log(req, status, started);
      });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

function log(req: IncomingMessage, status: number, started: number): void {
  if (req.url === "/health") return;
  const path = new URL(req.url ?? "/", "http://agent").pathname;
  console.log(
    JSON.stringify({
      method: req.method,
      path,
      status,
      ms: Date.now() - started,
    }),
  );
}
