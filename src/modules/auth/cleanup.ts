import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

const HOUR = 3_600_000;

export async function runCleanup(): Promise<void> {
  const now = Date.now();

  const attempts = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now - 24 * HOUR) } },
  });
  const sessions = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(now - 24 * HOUR) } },
        { revokedAt: { lt: new Date(now - 7 * 24 * HOUR) } },
      ],
    },
  });

  logger.debug(
    { attempts: attempts.count, sessions: sessions.count },
    "pembersihan data lama selesai",
  );
}

export function startCleanupJob(): NodeJS.Timeout {
  const run = () =>
    runCleanup().catch((err: unknown) =>
      logger.error({ err }, "pembersihan data lama gagal"),
    );
  void run();
  const timer = setInterval(run, HOUR);
  timer.unref();
  return timer;
}
