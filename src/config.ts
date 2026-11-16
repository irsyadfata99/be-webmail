export interface AgentConfig {
  token: string;
  domain: string;
  configDir: string;
  port: number;
  host: string;
}

/** Membaca dan memvalidasi konfigurasi. Pesan galat hanya menyebut nama variabel, tidak nilainya. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const problems: string[] = [];

  const token = env.AGENT_TOKEN ?? "";
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    problems.push("AGENT_TOKEN: harus 64 karakter hex (32 byte)");
  }

  const domain = (env.MAIL_DOMAIN ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    problems.push("MAIL_DOMAIN: domain tidak valid");
  }

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push("PORT: tidak valid");
  }

  const configDir = (env.CONFIG_DIR ?? "/config").trim();
  if (configDir.length === 0) problems.push("CONFIG_DIR: tidak boleh kosong");

  if (problems.length > 0) {
    throw new Error(`Konfigurasi tidak valid:\n  - ${problems.join("\n  - ")}`);
  }

  return { token, domain, configDir, port, host: env.HOST ?? "0.0.0.0" };
}
