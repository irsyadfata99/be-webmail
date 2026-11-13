import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { csrfProtection } from "../../middleware/csrf.js";
import {
  attachmentParams,
  attachmentQuery,
  composeDraftQuery,
  getMessageQuery,
  listMessagesQuery,
  messageParams,
  sendBody,
} from "./mail.schema.js";
import {
  MAX_OUTGOING_FILES,
  downloadContentType,
  fixFilenameEncoding,
  isInlineImageType,
  safeFilename,
} from "./mail.attachment.js";
import { type OutgoingFile, sendMessage } from "./mail.send.js";
import {
  getAttachment,
  getComposeDraft,
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
mailRouter.use(csrfProtection);

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

// Draf balas, balas semua, atau teruskan, siap dikirim ke POST /send.
mailRouter.get("/messages/:uid/draft", async (req, res) => {
  const { uid } = messageParams.parse(req.params);
  const { folder, mode } = composeDraftQuery.parse(req.query);
  const draft = await getComposeDraft(authOf(req), folder, uid, mode);
  res.set("Cache-Control", "no-store");
  res.json(draft);
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_ATTACHMENT_MB * 1024 * 1024,
    files: MAX_OUTGOING_FILES,
    fields: 5,
    fieldSize: 2 * 1024 * 1024,
  },
});

function uploadError(err: unknown): unknown {
  if (!(err instanceof multer.MulterError)) return err;
  if (err.code === "LIMIT_FILE_SIZE") {
    return new AppError(413, "ATTACHMENT_TOO_LARGE", "Lampiran terlalu besar");
  }
  if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
    return new AppError(400, "TOO_MANY_ATTACHMENTS", "Terlalu banyak lampiran");
  }
  return new AppError(400, "UPLOAD_INVALID", "Unggahan tidak valid");
}

/** Hanya request multipart yang diunggah lewat multer; JSON biasa dilewati. */
function parseUpload(req: Request, res: Response, next: NextFunction): void {
  if (!req.is("multipart/form-data")) return next();
  upload.array("attachments", MAX_OUTGOING_FILES)(req, res, (err: unknown) =>
    next(err ? uploadError(err) : undefined),
  );
}

function sendPayload(req: Request): unknown {
  if (!req.is("multipart/form-data")) return req.body;
  const raw = (req.body as { payload?: unknown } | undefined)?.payload;
  if (typeof raw !== "string") {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Kolom payload (JSON) wajib diisi",
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Kolom payload bukan JSON yang valid",
    );
  }
}

// Kirim pesan baru: JSON biasa, atau multipart (kolom `payload` JSON + berkas `attachments`).
// Pengirim selalu akun sesi; dibatasi jumlah penerima, lampiran, dan per jam.
mailRouter.post("/send", parseUpload, async (req, res) => {
  const body = sendBody.parse(sendPayload(req));
  const files: OutgoingFile[] = (
    (req.files as Express.Multer.File[] | undefined) ?? []
  ).map((f) => ({
    filename: fixFilenameEncoding(f.originalname),
    contentType: f.mimetype,
    content: f.buffer,
  }));
  const result = await sendMessage(req, authOf(req), body, files);
  res.set("Cache-Control", "no-store");
  res.status(201).json(result);
});
