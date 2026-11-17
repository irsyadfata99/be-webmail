import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { csrfProtection } from "../../middleware/csrf.js";
import { AppError } from "../../middleware/error-handler.js";
import { getAgent } from "../admin/agent.client.js";
import { passwordChangeBody, profileBody } from "./account.schema.js";
import {
  changePassword,
  getProfile,
  updateProfile,
} from "./account.service.js";

const accountLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
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

export const accountRouter = Router();

accountRouter.use(accountLimiter);
accountRouter.use(requireAuth);
accountRouter.use(csrfProtection);
accountRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

accountRouter.get("/profile", async (req, res) => {
  res.json(await getProfile(authOf(req)));
});

accountRouter.patch("/profile", async (req, res) => {
  const body = profileBody.parse(req.body);
  res.json(await updateProfile(req, authOf(req), body));
});

accountRouter.put("/password", async (req, res) => {
  const body = passwordChangeBody.parse(req.body);
  res.json(await changePassword(req, authOf(req), getAgent(), body));
});
