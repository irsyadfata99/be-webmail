import type { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { type PageInfo, pageInfo } from "../mail/mail.page.js";
import type { AuditLogsQuery } from "./admin.schema.js";

export interface AuditLogView {
  id: string;
  action: string;
  /** null bila pelakunya sudah dihapus atau aksi tidak punya pelaku (mis. login gagal). */
  actorEmail: string | null;
  targetEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export function auditWhere(q: AuditLogsQuery): Prisma.AuditLogWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from) createdAt.gte = q.from;
  if (q.to) createdAt[q.toInclusive ? "lte" : "lt"] = q.to;

  return {
    ...(q.actor ? { actor: { email: q.actor } } : {}),
    ...(q.target ? { targetEmail: q.target } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from || q.to ? { createdAt } : {}),
  };
}

/** Log audit terbaru dulu, dengan info halaman ala daftar pesan. */
export async function listAuditLogs(
  q: AuditLogsQuery,
): Promise<{ logs: AuditLogView[]; page: PageInfo }> {
  const where = auditWhere(q);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { actor: { select: { email: true } } },
    }),
  ]);

  return {
    logs: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorEmail: r.actor?.email ?? null,
      targetEmail: r.targetEmail,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
    page: pageInfo(total, q.page, q.pageSize),
  };
}
