import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireMonitorKey } from "./monitor.auth.js";
import { getStatus } from "./monitor.service.js";

const tooMany = (_req: unknown, _res: unknown, next: (e: unknown) => void) =>
  next(
    new AppError(
      429,
      "TOO_MANY_REQUESTS",
      "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
    ),
  );

// Menahan tebakan kunci: hanya permintaan yang ditolak (status 4xx) yang dihitung.
const failedLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: tooMany,
});

const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: tooMany,
});

export const monitorRouter = Router();

monitorRouter.use(generalLimiter, failedLimiter);

monitorRouter.get("/status", requireMonitorKey, async (_req, res) => {
  const status = await getStatus();
  res.set("Cache-Control", "no-store");
  // 503 hanya bila layanan inti mati, agar alat pemantau sederhana pun bisa memakai kode HTTP.
  res.status(status.status === "down" ? 503 : 200).json(status);
});
