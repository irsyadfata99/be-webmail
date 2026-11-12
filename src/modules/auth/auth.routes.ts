import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { clearAuthCookies, setAuthCookies } from "../../lib/cookies.js";
import { authenticate } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import { loginSchema } from "./auth.schema.js";
import { login, logout } from "./auth.service.js";

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: (_req, _res, next) =>
    next(
      new AppError(
        429,
        "TOO_MANY_REQUESTS",
        "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
      ),
    ),
});

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await login(req, email, password);

  setAuthCookies(res, result.sessionToken, result.csrfToken, result.expiresAt);
  res.set("Cache-Control", "no-store");
  res.json({
    user: result.user,
    twoFactorRequired: result.twoFactorRequired,
  });
});

authRouter.get("/me", authenticate, (req, res) => {
  const auth = req.auth;
  if (!auth) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sesi tidak valid atau sudah berakhir",
    );
  }
  res.set("Cache-Control", "no-store");
  res.json({
    user: auth.user,
    twoFactorRequired: auth.user.twoFactorEnabled && !auth.twoFactorVerified,
  });
});

authRouter.post("/logout", async (req, res) => {
  await logout(req);
  clearAuthCookies(res);
  res.status(204).end();
});
