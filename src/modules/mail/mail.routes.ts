import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { listMessagesQuery } from "./mail.schema.js";
import { listFolders, listMessages } from "./mail.service.js";

const mailLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
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

export const mailRouter = Router();

mailRouter.use(mailLimiter);
mailRouter.use(requireAuth);

mailRouter.get("/folders", async (req, res) => {
  const folders = await listFolders(authOf(req));
  res.set("Cache-Control", "no-store");
  res.json({ folders });
});

// Folder lewat query (bukan path) agar nama dengan "/" atau "." aman melewati proxy.
mailRouter.get("/messages", async (req, res) => {
  const { folder, page, pageSize } = listMessagesQuery.parse(req.query);
  const result = await listMessages(authOf(req), folder, page, pageSize);
  res.set("Cache-Control", "no-store");
  res.json(result);
});
