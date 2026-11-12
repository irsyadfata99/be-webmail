import { Router } from "express";
import { healthRouter } from "./health.js";

export const routes = Router();

routes.use(healthRouter);
// Modul lain didaftarkan di sini, mis. routes.use("/api/auth", authRouter)
