import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { disconnectDatabase } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "server berjalan");
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "menutup server");

  const force = setTimeout(() => {
    logger.error("shutdown terlalu lama, keluar paksa");
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close((err) => {
    if (err) logger.error({ err }, "gagal menutup server");
    disconnectDatabase()
      .catch((e: unknown) => logger.error({ err: e }, "gagal menutup database"))
      .finally(() => process.exit(err ? 1 : 0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandledRejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});
