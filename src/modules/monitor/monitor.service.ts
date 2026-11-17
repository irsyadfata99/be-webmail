import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { heavyGateStats } from "../mail/mail.service.js";
import {
  checkAgent,
  checkDatabase,
  probe,
  type AgentState,
  type Probe,
  type Timed,
} from "./monitor.checks.js";

export type Level = "ok" | "degraded" | "down";

/** Sertifikat yang tersisa kurang dari ini dilaporkan sebagai peringatan. */
export const CERT_WARN_DAYS = 21;
/** Antrean pengurai pesan besar (maksimal 10) dianggap padat bila sebanyak ini. */
export const QUEUE_BUSY_AT = 8;
const CACHE_MS = 10_000;
const HOUR_MS = 3_600_000;
const startedAt = new Date();

export interface SummaryInput {
  database: boolean;
  imap: boolean;
  smtp: boolean;
  agent: AgentState;
  tls: Array<{
    name: string;
    authorized: boolean;
    daysLeft: number | null;
  } | null>;
  heavyWaiting: number;
}

/** Menentukan status keseluruhan dan daftar kode masalah. down: database atau IMAP mati. */
export function summarize(input: SummaryInput): {
  status: Level;
  issues: string[];
} {
  const issues: string[] = [];
  let status: Level = "ok";
  const worsen = (level: Level): void => {
    if (level === "down" || status === "ok") status = level;
  };

  if (!input.database) {
    issues.push("DATABASE_DOWN");
    worsen("down");
  }
  if (!input.imap) {
    issues.push("IMAP_DOWN");
    worsen("down");
  }
  if (!input.smtp) {
    issues.push("SMTP_DOWN");
    worsen("degraded");
  }
  if (input.agent === "down") {
    issues.push("ACCOUNT_AGENT_DOWN");
    worsen("degraded");
  }
  for (const t of input.tls) {
    if (!t) continue;
    if (!t.authorized) {
      issues.push(`${t.name}_CERT_NOT_TRUSTED`);
      worsen("degraded");
    }
    if (t.daysLeft !== null && t.daysLeft < CERT_WARN_DAYS) {
      issues.push(`${t.name}_CERT_EXPIRES_SOON`);
      worsen("degraded");
    }
  }
  if (input.heavyWaiting >= QUEUE_BUSY_AT) {
    issues.push("HEAVY_QUEUE_BUSY");
    worsen("degraded");
  }
  return { status, issues };
}

export interface MailProbeView {
  up: boolean;
  ms: number | null;
  tls: Probe["tls"];
  error: string | null;
}

export interface MonitorStatus {
  status: Level;
  issues: string[];
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  services: {
    database: Timed;
    imap: MailProbeView;
    smtp: MailProbeView;
    accountAgent: { status: AgentState; ms: number | null };
  };
  /** Hanya hitungan; tidak memuat email, nama, atau isi surel. null bila database tidak terjawab. */
  activity: {
    activeSessions: number | null;
    failedLoginsLastHour: number | null;
    mailsSentLastHour: number | null;
    heavyParse: { active: number; waiting: number };
  };
}

async function countActivity(): Promise<Array<number | null>> {
  const now = new Date();
  const since = new Date(now.getTime() - HOUR_MS);
  try {
    return await Promise.all([
      prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: now } },
      }),
      prisma.loginAttempt.count({
        where: { success: false, createdAt: { gte: since } },
      }),
      prisma.auditLog.count({
        where: { action: "MAIL_SENT", createdAt: { gte: since } },
      }),
    ]);
  } catch {
    return [null, null, null];
  }
}

export async function collectStatus(): Promise<MonitorStatus> {
  const [database, imap, smtp, agent, counts] = await Promise.all([
    checkDatabase(),
    probe(env.IMAP_HOST, env.IMAP_PORT, env.IMAP_SECURE),
    probe(env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE),
    checkAgent(env.AGENT_URL),
    countActivity(),
  ]);
  const heavy = heavyGateStats();
  const { status, issues } = summarize({
    database: database.up,
    imap: imap.up,
    smtp: smtp.up,
    agent: agent.status,
    tls: [
      imap.tls ? { name: "IMAP", ...imap.tls } : null,
      smtp.tls ? { name: "SMTP", ...smtp.tls } : null,
    ],
    heavyWaiting: heavy.waiting,
  });
  const [activeSessions, failedLoginsLastHour, mailsSentLastHour] = counts;
  return {
    status,
    issues,
    checkedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    services: { database, imap, smtp, accountAgent: agent },
    activity: {
      activeSessions: activeSessions ?? null,
      failedLoginsLastHour: failedLoginsLastHour ?? null,
      mailsSentLastHour: mailsSentLastHour ?? null,
      heavyParse: heavy,
    },
  };
}

let cache: { at: number; value: MonitorStatus } | null = null;

/** Hasil disimpan 10 detik agar aplikasi monitoring yang rajin tidak membebani server. */
export async function getStatus(now = Date.now()): Promise<MonitorStatus> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const value = await collectStatus();
  cache = { at: now, value };
  return value;
}

export function resetStatusCache(): void {
  cache = null;
}
