import type { Request } from "express";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetEmail?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function writeAudit(
  req: Request,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetEmail: entry.targetEmail ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "gagal menulis audit log");
  }
}
