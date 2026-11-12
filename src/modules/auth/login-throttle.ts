import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";

const IP_MULTIPLIER = 4;

export async function assertNotThrottled(
  email: string,
  ip: string,
): Promise<void> {
  const since = new Date(Date.now() - env.LOGIN_WINDOW_MINUTES * 60_000);
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email, success: false, createdAt: { gte: since } },
    }),
    prisma.loginAttempt.count({
      where: { ipAddress: ip, success: false, createdAt: { gte: since } },
    }),
  ]);
  if (
    byEmail >= env.LOGIN_MAX_ATTEMPTS ||
    byIp >= env.LOGIN_MAX_ATTEMPTS * IP_MULTIPLIER
  ) {
    throw new AppError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Terlalu banyak percobaan login. Coba lagi dalam ${env.LOGIN_WINDOW_MINUTES} menit.`,
    );
  }
}

export async function recordFailure(email: string, ip: string): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email, ipAddress: ip, success: false },
  });
}

export async function clearFailures(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email, success: false } });
}
