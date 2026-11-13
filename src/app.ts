import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { routes } from "./routes/index.js";
import { originGuard } from "./middleware/csrf.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  if (env.TRUST_PROXY) {
    app.set("trust proxy", env.TRUST_PROXY);
  }

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"],
      maxAge: 600,
    }),
  );
  // Isi email bisa lebih besar dari 100kb; body-parser melewati bila body sudah terurai.
  app.use("/api/mail/send", express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(originGuard);

  app.use(routes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
