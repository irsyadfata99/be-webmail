import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { mailRouter } from "../modules/mail/mail.routes.js";
import { healthRouter } from "./health.js";

export const routes = Router();

routes.use(healthRouter);
routes.use("/api/auth", authRouter);
routes.use("/api/mail", mailRouter);
// Modul lain didaftarkan di sini
