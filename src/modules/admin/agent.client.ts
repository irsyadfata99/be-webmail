import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";

export interface AgentAccount {
  email: string;
  quota: string | null;
  /** true bila login IMAP/SMTP akun dikunci oleh layanan akun. */
  disabled: boolean;
}

/** Antarmuka layanan akun; dipisah agar tes bisa memakai tiruan. */
export interface AgentApi {
  list(): Promise<AgentAccount[]>;
  create(email: string, password: string): Promise<void>;
  setPassword(email: string, password: string): Promise<void>;
  setQuota(email: string, quota: string | null): Promise<void>;
  /** false mengunci login IMAP/SMTP; true membukanya lagi. Idempoten. */
  setActive(email: string, active: boolean): Promise<void>;
  remove(email: string): Promise<void>;
}

export interface AgentClientOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const unavailable = () =>
  new AppError(
    503,
    "AGENT_UNAVAILABLE",
    "Layanan akun tidak dapat dihubungi. Coba lagi nanti.",
  );

export function createAgentClient(options: AgentClientOptions): AgentApi {
  const base = options.url.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw unavailable();
    }

    let data: unknown = null;
    try {
      const text = await res.text();
      data = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (res.ok) return data;

    // 401 dan galat server berarti salah konfigurasi atau layanan rusak: jangan bocorkan ke klien.
    if (res.status === 401 || res.status >= 500) {
      throw new AppError(
        502,
        "AGENT_FAILED",
        "Layanan akun gagal memproses permintaan",
      );
    }
    const err = (
      data as { error?: { code?: unknown; message?: unknown } } | null
    )?.error;
    throw new AppError(
      res.status,
      typeof err?.code === "string" ? err.code : "AGENT_ERROR",
      typeof err?.message === "string"
        ? err.message
        : "Layanan akun menolak permintaan",
    );
  }

  const account = (email: string) => `/accounts/${encodeURIComponent(email)}`;

  return {
    async list() {
      const data = (await call("GET", "/accounts")) as {
        accounts?: unknown;
      } | null;
      if (!data || !Array.isArray(data.accounts)) {
        throw new AppError(
          502,
          "AGENT_FAILED",
          "Layanan akun gagal memproses permintaan",
        );
      }
      return data.accounts.flatMap((a: unknown) => {
        const row = a as {
          email?: unknown;
          quota?: unknown;
          disabled?: unknown;
        };
        if (typeof row.email !== "string") return [];
        return [
          {
            email: row.email,
            quota: typeof row.quota === "string" ? row.quota : null,
            disabled: row.disabled === true,
          },
        ];
      });
    },
    async create(email, password) {
      await call("POST", "/accounts", { email, password });
    },
    async setPassword(email, password) {
      await call("PUT", `${account(email)}/password`, { password });
    },
    async setQuota(email, quota) {
      await call("PUT", `${account(email)}/quota`, { quota });
    },
    async setActive(email, active) {
      await call("PUT", `${account(email)}/active`, { active });
    },
    async remove(email) {
      await call("DELETE", account(email));
    },
  };
}

let shared: AgentApi | null = null;

/** Klien bersama dari env; 503 bila AGENT_URL dan AGENT_TOKEN belum diisi. */
export function getAgent(): AgentApi {
  if (shared) return shared;
  if (!env.AGENT_URL || !env.AGENT_TOKEN) {
    throw new AppError(
      503,
      "AGENT_NOT_CONFIGURED",
      "Layanan akun belum dikonfigurasi",
    );
  }
  shared = createAgentClient({ url: env.AGENT_URL, token: env.AGENT_TOKEN });
  return shared;
}
