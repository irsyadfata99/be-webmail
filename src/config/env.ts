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
