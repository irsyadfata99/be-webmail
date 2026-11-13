import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  attachmentParams,
  attachmentQuery,
  getMessageQuery,
  listMessagesQuery,
  messageParams,
} from "./mail.schema.js";
import {
  downloadContentType,
  isInlineImageType,
  safeFilename,
} from "./mail.attachment.js";
import {
  getAttachment,
  getMessage,
  listFolders,
  listMessages,
} from "./mail.service.js";

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

// Membuka satu pesan. Bawaan: tidak menandai dibaca dan gambar eksternal diblokir.
mailRouter.get("/messages/:uid", async (req, res) => {
  const { uid } = messageParams.parse(req.params);
  const { folder, images, markSeen } = getMessageQuery.parse(req.query);
  const message = await getMessage(authOf(req), folder, uid, {
    images,
    markSeen,
  });
  res.set("Cache-Control", "no-store");
  res.json(message);
});

// Unduh satu lampiran. Selalu `attachment`, kecuali gambar raster dengan ?inline=1.
mailRouter.get("/messages/:uid/attachments/:index", async (req, res) => {
  const { uid, index } = attachmentParams.parse(req.params);
  const { folder, inline } = attachmentQuery.parse(req.query);
  const file = await getAttachment(authOf(req), folder, uid, index);

  const showInline = inline && isInlineImageType(file.contentType);
  res.set({
    "Content-Type": showInline
      ? file.contentType.toLowerCase()
      : downloadContentType(file.contentType),
    "Content-Length": String(file.content.length),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": showInline ? "private, max-age=600" : "no-store",
  });
  if (showInline) {
    res.set("Content-Disposition", "inline");
  } else {
    res.attachment(safeFilename(file.filename, `lampiran-${index}`));
  }
  res.end(file.content);
});
