import { spawn } from "node:child_process";

const SHA512_CRYPT = /^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/;
const TIMEOUT_MS = 5000;

/**
 * Membuat hash SHA512-CRYPT ($6$...) yang dipakai Dovecot, lewat `openssl passwd -6`.
 * Password dikirim lewat stdin supaya tidak terlihat di daftar proses.
 */
export function hashPassword(
  password: string,
  opensslPath = "openssl",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opensslPath, ["passwd", "-6", "-stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("openssl melebihi batas waktu"));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const hash = out.trim();
      if (code === 0 && SHA512_CRYPT.test(hash)) resolve(hash);
      else reject(new Error("openssl gagal membuat hash"));
    });
    child.stdin.on("error", () => {
      // Galat tulis ke stdin ditangani lewat event close/error proses.
    });
    child.stdin.end(`${password}\n`);
  });
}
