import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Rute tidak ditemukan" } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Data tidak valid",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return;
  }

  const e = err as { type?: string };
  if (e.type === "entity.too.large") {
    res
      .status(413)
      .json({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Data terlalu besar" },
      });
    return;
  }
  if (e.type === "entity.parse.failed") {
    res
      .status(400)
      .json({
        error: { code: "BAD_REQUEST", message: "Format JSON tidak valid" },
      });
    return;
  }

  req.log.error({ err }, "kesalahan tak terduga");
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server" },
  });
};
