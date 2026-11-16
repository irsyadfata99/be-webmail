import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { authenticate, requireAuth } from "../../middleware/auth.js";
import { csrfProtection } from "../../middleware/csrf.js";
import { AppError } from "../../middleware/error-handler.js";
import { enableBody, factorBody } from "./twofactor.schema.js";
import {
  beginSetup,
  disableTwoFactor,
  enableTwoFactor,
  getStatus,
  regenerateRecoveryCodes,
  verifyLogin,
} from "./twofactor.service.js";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
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

function authOf(req: Request): Express.AuthContext {
  if (!req.auth) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Sesi tidak valid atau sudah berakhir",
    );
  }
  return req.auth;
}

export const twoFactorRouter = Router();

twoFactorRouter.use(limiter);
// Rahasia dan kode pemulihan tidak boleh tersimpan di cache.
twoFactorRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

twoFactorRouter.get("/", requireAuth, async (req, res) => {
  res.json(await getStatus(authOf(req)));
});

twoFactorRouter.post(
  "/setup",
  requireAuth,
  csrfProtection,
  async (req, res) => {
    res.json(await beginSetup(req, authOf(req)));
  },
);

twoFactorRouter.post(
  "/enable",
  requireAuth,
  csrfProtection,
  async (req, res) => {
    const { code } = enableBody.parse(req.body);
    res.json(await enableTwoFactor(req, authOf(req), code));
  },
);

// Memakai authenticate (bukan requireAuth): inilah langkah yang meloloskan sesi dari 2FA.
twoFactorRouter.post(
  "/verify",
  authenticate,
  csrfProtection,
  async (req, res) => {
    res.json(await verifyLogin(req, authOf(req), factorBody.parse(req.body)));
  },
);

twoFactorRouter.post(
  "/disable",
  requireAuth,
  csrfProtection,
  async (req, res) => {
    res.json(
      await disableTwoFactor(req, authOf(req), factorBody.parse(req.body)),
    );
  },
);

twoFactorRouter.post(
  "/recovery-codes",
  requireAuth,
  csrfProtection,
  async (req, res) => {
    res.json(
      await regenerateRecoveryCodes(
        req,
        authOf(req),
        factorBody.parse(req.body),
      ),
    );
  },
);
