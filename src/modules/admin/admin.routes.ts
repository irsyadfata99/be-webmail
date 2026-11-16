import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { csrfProtection } from "../../middleware/csrf.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  accountParams,
  createAccountBody,
  passwordBody,
  patchAccountBody,
  quotaBody,
} from "./admin.schema.js";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  patchAccount,
  resetPassword,
  setQuota,
} from "./admin.service.js";
import { getAgent } from "./agent.client.js";

const adminLimiter = rateLimit({
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

export const adminRouter = Router();

adminRouter.use(adminLimiter);
adminRouter.use(requireAuth);
adminRouter.use(csrfProtection);
adminRouter.use(requireAdmin);
adminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

adminRouter.get("/accounts", async (_req, res) => {
  res.json({ accounts: await listAccounts(getAgent()) });
});

adminRouter.post("/accounts", async (req, res) => {
  const body = createAccountBody.parse(req.body);
  const result = await createAccount(req, authOf(req), getAgent(), body);
  res.status(201).json(result);
});

adminRouter.put("/accounts/:email/password", async (req, res) => {
  const { email } = accountParams.parse(req.params);
  const { password } = passwordBody.parse(req.body);
  res.json(await resetPassword(req, authOf(req), getAgent(), email, password));
});

adminRouter.put("/accounts/:email/quota", async (req, res) => {
  const { email } = accountParams.parse(req.params);
  const { quota } = quotaBody.parse(req.body);
  res.json(await setQuota(req, authOf(req), getAgent(), email, quota));
});

adminRouter.patch("/accounts/:email", async (req, res) => {
  const { email } = accountParams.parse(req.params);
  const body = patchAccountBody.parse(req.body);
  res.json(await patchAccount(req, authOf(req), getAgent(), email, body));
});

adminRouter.delete("/accounts/:email", async (req, res) => {
  const { email } = accountParams.parse(req.params);
  res.json(await deleteAccount(req, authOf(req), getAgent(), email));
});
