import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/health", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "up",
      uptime: Math.round(process.uptime()),
    });
  } catch (err) {
    req.log.error({ err }, "health check: database tidak tersambung");
    res.status(503).json({ status: "degraded", database: "down" });
  }
});
