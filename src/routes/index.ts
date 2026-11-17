import { Router } from "express";
import { accountRouter } from "../modules/account/account.routes.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { mailRouter } from "../modules/mail/mail.routes.js";
import { healthRouter } from "./health.js";

export const routes = Router();

routes.use(healthRouter);
routes.use("/api/auth", authRouter);
routes.use("/api/mail", mailRouter);
routes.use("/api/admin", adminRouter);
routes.use("/api/account", accountRouter);
// Modul lain didaftarkan di sini
