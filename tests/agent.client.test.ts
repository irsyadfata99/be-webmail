import "dotenv/config";
import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "harus 64 karakter hex (32 byte)");

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: port.default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: z
      .string()
      .refine(
        (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
        "harus berupa URL PostgreSQL",
      ),

    IMAP_HOST: z.string().min(1),
    IMAP_PORT: port.default(993),
    IMAP_SECURE: z.stringbool().default(true),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: port.default(465),
    SMTP_SECURE: z.stringbool().default(true),

    MAIL_DOMAIN: z
      .string()
      .min(3)
      .transform((v) => v.trim().toLowerCase().replace(/^@/, ""))
      .pipe(
        z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "domain tidak valid"),
      ),

    SESSION_SECRET: hex64,
    CREDENTIAL_ENCRYPTION_KEY: hex64,
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    CORS_ORIGIN: z
      .string()
      .min(1)
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    COOKIE_SECURE: z.stringbool().default(false),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

    // Jumlah reverse proxy tepercaya di depan backend (VPS = 1). 0 jika diakses langsung.
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((v) => {
        const list = (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return list.length > 0 ? list : undefined;
      }),

    // Batas per berkas dan total lampiran per pesan (ukuran mentah). Setelah base64
    // ukuran pesan sekitar 1,37x lipat, jadi total dijaga jauh di bawah batas server
    // dan penerima (Gmail 25 MB). Samakan dengan POSTFIX_MESSAGE_SIZE_LIMIT, relay VPS, dan Nginx.
    MAX_ATTACHMENT_MB: z.coerce.number().int().min(1).max(100).default(10),
    MAX_TOTAL_ATTACHMENT_MB: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(15),

    // Ukuran pesan terbesar yang boleh dibuka (terima). Setara batas terima Gmail 50 MB;
    // samakan dengan POSTFIX_MESSAGE_SIZE_LIMIT di mailserver dan message_size_limit di relay VPS.
    MAX_MESSAGE_MB: z.coerce.number().int().min(1).max(200).default(50),

    // Layanan akun (account-agent) di jaringan Docker yang sama. Keduanya diisi atau keduanya kosong;
    // bila kosong, rute /api/admin mengembalikan 503 AGENT_NOT_CONFIGURED.
    AGENT_URL: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
      .pipe(z.url().optional()),
    AGENT_TOKEN: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
      .pipe(hex64.optional()),

    ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .refine((e) => e.SESSION_SECRET !== e.CREDENTIAL_ENCRYPTION_KEY, {
    message: "SESSION_SECRET dan CREDENTIAL_ENCRYPTION_KEY tidak boleh sama",
    path: ["CREDENTIAL_ENCRYPTION_KEY"],
  })
  .refine(
    (e) => (e.AGENT_URL === undefined) === (e.AGENT_TOKEN === undefined),
    {
      message: "AGENT_URL dan AGENT_TOKEN harus diisi bersamaan",
      path: ["AGENT_TOKEN"],
    },
  )
  .refine((e) => e.MAX_ATTACHMENT_MB <= e.MAX_TOTAL_ATTACHMENT_MB, {
    message: "tidak boleh lebih besar dari MAX_TOTAL_ATTACHMENT_MB",
    path: ["MAX_ATTACHMENT_MB"],
  })
  .refine((e) => e.NODE_ENV !== "production" || e.COOKIE_SECURE, {
    message: "wajib true di production",
    path: ["COOKIE_SECURE"],
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  // Logger belum tersedia di tahap ini, dan nilai variabel sengaja tidak dicetak.
  console.error(`Konfigurasi .env tidak valid:\n${detail}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/middleware/error-handler.js";
import { createAgentClient } from "../src/modules/admin/agent.client.js";
import { toAccountView } from "../src/modules/admin/admin.view.js";

const TOKEN = "a".repeat(64);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createAgentClient({
    url: "http://account-agent:4000/",
    token: TOKEN,
    fetchImpl,
  });
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    return err as AppError;
  }
  throw new Error("seharusnya gagal");
}

describe("createAgentClient", () => {
  it("list: membawa token, membuang garis miring di ujung URL, dan merapikan hasil", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        accounts: [
          { email: "a@contoh.id", quota: "2G", disabled: true },
          { email: "b@contoh.id", quota: null },
          { quota: "1G" },
        ],
      }),
    );
    const accounts = await clientWith(fetchImpl as never).list();
    expect(accounts).toEqual([
      { email: "a@contoh.id", quota: "2G", disabled: true },
      { email: "b@contoh.id", quota: null, disabled: false },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://account-agent:4000/accounts");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("create: mengirim JSON ke POST /accounts", async () => {
    const fetchImpl = vi.fn(async () => json(201, { email: "a@contoh.id" }));
    await clientWith(fetchImpl as never).create(
      "a@contoh.id",
      "rahasia-panjang",
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://account-agent:4000/accounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@contoh.id",
      password: "rahasia-panjang",
    });
  });

  it("password, kuota, dan hapus memakai rute dan metode yang benar (email di-encode)", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const c = clientWith(fetchImpl as never);
    await c.setPassword("a@contoh.id", "rahasia-panjang");
    await c.setQuota("a@contoh.id", null);
    await c.setActive("a@contoh.id", false);
    await c.remove("a@contoh.id");
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => `${i.method} ${u}`)).toEqual([
      "PUT http://account-agent:4000/accounts/a%40contoh.id/password",
      "PUT http://account-agent:4000/accounts/a%40contoh.id/quota",
      "PUT http://account-agent:4000/accounts/a%40contoh.id/active",
      "DELETE http://account-agent:4000/accounts/a%40contoh.id",
    ]);
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ quota: null });
    expect(JSON.parse(calls[2]![1].body as string)).toEqual({ active: false });
  });

  it("galat 4xx dari agent diteruskan dengan kode aslinya", async () => {
    const fetchImpl = vi.fn(async () =>
      json(409, {
        error: { code: "ACCOUNT_EXISTS", message: "Akun sudah ada" },
      }),
    );
    const err = await errorOf(
      clientWith(fetchImpl as never).create("a@contoh.id", "rahasia-panjang"),
    );
    expect(err).toMatchObject({ status: 409, code: "ACCOUNT_EXISTS" });
  });

  it("401 dan 5xx dari agent menjadi 502 AGENT_FAILED tanpa membocorkan pesan", async () => {
    for (const status of [401, 500, 503]) {
      const fetchImpl = vi.fn(async () =>
        json(status, { error: { code: "X", message: "rahasia internal" } }),
      );
      const err = await errorOf(clientWith(fetchImpl as never).list());
      expect(err).toMatchObject({ status: 502, code: "AGENT_FAILED" });
      expect(err.message).not.toMatch(/rahasia/);
    }
  });

  it("agent tidak terjangkau menjadi 503 AGENT_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await errorOf(clientWith(fetchImpl as never).list());
    expect(err).toMatchObject({ status: 503, code: "AGENT_UNAVAILABLE" });
  });

  it("badan balasan yang bukan bentuk daftar menjadi 502", async () => {
    const fetchImpl = vi.fn(async () => json(200, { oops: true }));
    const err = await errorOf(clientWith(fetchImpl as never).list());
    expect(err).toMatchObject({ status: 502, code: "AGENT_FAILED" });
  });
});

describe("toAccountView", () => {
  const admins = ["admin@contoh.id"];

  it("memakai data database bila ada", () => {
    const view = toAccountView(
      { email: "budi@contoh.id", quota: "2G", disabled: false },
      {
        displayName: "Budi S",
        role: "USER",
        isActive: false,
        twoFactorEnabled: true,
        lastLoginAt: new Date("2026-11-16T05:00:00Z"),
      },
      admins,
    );
    expect(view).toEqual({
      email: "budi@contoh.id",
      quota: "2G",
      displayName: "Budi S",
      role: "USER",
      isActive: false,
      twoFactorEnabled: true,
      lastLoginAt: "2026-11-16T05:00:00.000Z",
      registered: true,
    });
  });

  it("akun yang terkunci di mailserver tampil nonaktif walau database mencatat aktif", () => {
    const user = {
      displayName: "Budi",
      role: "USER" as const,
      isActive: true,
      twoFactorEnabled: false,
      lastLoginAt: null,
    };
    expect(
      toAccountView(
        { email: "budi@contoh.id", quota: null, disabled: true },
        user,
        admins,
      ).isActive,
    ).toBe(false);
    expect(
      toAccountView(
        { email: "budi@contoh.id", quota: null, disabled: false },
        user,
        admins,
      ).isActive,
    ).toBe(true);
    expect(
      toAccountView(
        { email: "baru@contoh.id", quota: null, disabled: true },
        undefined,
        admins,
      ).isActive,
    ).toBe(false);
  });

  it("akun yang belum pernah login: nama dari bagian lokal, role dari ADMIN_EMAILS, belum terdaftar", () => {
    expect(
      toAccountView(
        { email: "admin@contoh.id", quota: null, disabled: false },
        undefined,
        admins,
      ),
    ).toMatchObject({
      displayName: "admin",
      role: "ADMIN",
      isActive: true,
      lastLoginAt: null,
      registered: false,
    });
    expect(
      toAccountView(
        { email: "siti@contoh.id", quota: null, disabled: false },
        undefined,
        admins,
      ).role,
    ).toBe("USER");
  });
});
