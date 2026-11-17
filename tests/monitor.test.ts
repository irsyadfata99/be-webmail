import net from "node:net";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/lib/logger.js";
import { disconnectDatabase } from "../src/lib/prisma.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import {
  bearerToken,
  matchesAnyKey,
  requireMonitorKey,
} from "../src/modules/monitor/monitor.auth.js";
import {
  checkAgent,
  daysUntil,
  probe,
} from "../src/modules/monitor/monitor.checks.js";
import {
  QUEUE_BUSY_AT,
  resetStatusCache,
  summarize,
  type SummaryInput,
} from "../src/modules/monitor/monitor.service.js";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const original = [...env.MONITOR_KEYS];

afterAll(async () => {
  env.MONITOR_KEYS = original;
  await disconnectDatabase();
});

describe("bearerToken dan matchesAnyKey", () => {
  it("membaca header Bearer yang benar saja", () => {
    expect(bearerToken(`Bearer ${KEY_A}`)).toBe(KEY_A);
    expect(bearerToken(`bearer ${KEY_A}`)).toBe(KEY_A);
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken(`Basic ${KEY_A}`)).toBeNull();
    expect(bearerToken(`Bearer ${KEY_A} tambahan`)).toBeNull();
  });

  it("cocok dengan salah satu dari dua kunci, menolak yang lain", () => {
    expect(matchesAnyKey(KEY_A, [KEY_A, KEY_B])).toBe(true);
    expect(matchesAnyKey(KEY_B, [KEY_A, KEY_B])).toBe(true);
    expect(matchesAnyKey("c".repeat(64), [KEY_A, KEY_B])).toBe(false);
    expect(matchesAnyKey(KEY_A, [])).toBe(false);
    expect(matchesAnyKey("", [KEY_A])).toBe(false);
  });
});

describe("requireMonitorKey", () => {
  const app = express();
  // Aplikasi mini ini tanpa pino-http, jadi req.log disediakan di sini.
  app.use((req, _res, next) => {
    req.log = logger;
    next();
  });
  app.get("/x", requireMonitorKey, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);

  beforeEach(() => {
    env.MONITOR_KEYS = [KEY_A, KEY_B];
  });
  afterEach(() => {
    env.MONITOR_KEYS = original;
  });

  it("tanpa kunci atau kunci salah: 401 dengan WWW-Authenticate", async () => {
    const none = await request(app).get("/x");
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toBe("Bearer");
    const bad = await request(app)
      .get("/x")
      .set("Authorization", `Bearer ${"c".repeat(64)}`);
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");
  });

  it("kedua kunci diterima", async () => {
    for (const key of [KEY_A, KEY_B]) {
      const res = await request(app)
        .get("/x")
        .set("Authorization", `Bearer ${key}`);
      expect(res.status).toBe(200);
    }
  });

  it("tanpa kunci terkonfigurasi endpoint seolah tidak ada (404)", async () => {
    env.MONITOR_KEYS = [];
    const res = await request(app)
      .get("/x")
      .set("Authorization", `Bearer ${KEY_A}`);
    expect(res.status).toBe(404);
  });
});

describe("summarize", () => {
  const healthy: SummaryInput = {
    database: true,
    imap: true,
    smtp: true,
    agent: "up",
    tls: [
      { name: "IMAP", authorized: true, daysLeft: 60 },
      { name: "SMTP", authorized: true, daysLeft: 60 },
    ],
    heavyWaiting: 0,
  };

  it("semua sehat: ok tanpa masalah", () => {
    expect(summarize(healthy)).toEqual({ status: "ok", issues: [] });
  });

  it("database atau IMAP mati: down", () => {
    expect(summarize({ ...healthy, database: false })).toEqual({
      status: "down",
      issues: ["DATABASE_DOWN"],
    });
    expect(summarize({ ...healthy, imap: false }).status).toBe("down");
  });

  it("SMTP, agent, sertifikat, dan antrean: degraded", () => {
    expect(summarize({ ...healthy, smtp: false })).toEqual({
      status: "degraded",
      issues: ["SMTP_DOWN"],
    });
    expect(summarize({ ...healthy, agent: "down" }).issues).toEqual([
      "ACCOUNT_AGENT_DOWN",
    ]);
    expect(summarize({ ...healthy, agent: "not_configured" }).status).toBe(
      "ok",
    );
    const cert = summarize({
      ...healthy,
      tls: [{ name: "IMAP", authorized: true, daysLeft: 5 }, null],
    });
    expect(cert).toEqual({
      status: "degraded",
      issues: ["IMAP_CERT_EXPIRES_SOON"],
    });
    expect(
      summarize({
        ...healthy,
        tls: [{ name: "SMTP", authorized: false, daysLeft: 60 }, null],
      }).issues,
    ).toEqual(["SMTP_CERT_NOT_TRUSTED"]);
    expect(
      summarize({ ...healthy, heavyWaiting: QUEUE_BUSY_AT }).issues,
    ).toEqual(["HEAVY_QUEUE_BUSY"]);
  });

  it("down tidak turun jadi degraded saat ada masalah lain", () => {
    const r = summarize({ ...healthy, database: false, smtp: false });
    expect(r.status).toBe("down");
    expect(r.issues).toEqual(["DATABASE_DOWN", "SMTP_DOWN"]);
  });
});

describe("daysUntil", () => {
  const now = Date.parse("2026-11-17T00:00:00Z");
  it("menghitung sisa hari penuh", () => {
    expect(daysUntil("Jan 15 00:00:00 2027 GMT", now)).toBe(59);
    expect(daysUntil("Nov 16 00:00:00 2026 GMT", now)).toBe(-1);
  });
  it("tidak terbaca: null", () => {
    expect(daysUntil(undefined, now)).toBeNull();
    expect(daysUntil("bukan tanggal", now)).toBeNull();
  });
});

describe("probe dan checkAgent", () => {
  it("probe TCP: hidup pada port yang mendengarkan, mati pada yang tidak", async () => {
    const server = net.createServer((s) => s.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    const up = await probe("127.0.0.1", port, false, 2000);
    expect(up.up).toBe(true);
    expect(up.ms).toBeGreaterThanOrEqual(0);
    await new Promise<void>((r) => server.close(() => r()));
    const down = await probe("127.0.0.1", port, false, 2000);
    expect(down.up).toBe(false);
    expect(down.error).toBeTruthy();
    expect(down.ms).toBeNull();
  });

  it("checkAgent: tidak dikonfigurasi, sehat, 500, dan jaringan putus", async () => {
    expect(await checkAgent(undefined)).toEqual({
      status: "not_configured",
      ms: null,
    });
    const ok = await checkAgent("http://agent:4000/", (async (url: string) => {
      expect(url).toBe("http://agent:4000/health");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    expect(ok.status).toBe("up");
    const bad = await checkAgent(
      "http://agent:4000",
      (async () =>
        new Response("x", { status: 500 })) as unknown as typeof fetch,
    );
    expect(bad.status).toBe("down");
    const err = await checkAgent("http://agent:4000", (async () => {
      throw new Error("putus");
    }) as unknown as typeof fetch);
    expect(err.status).toBe("down");
  });
});

describe("GET /api/monitor/status", () => {
  const app = createApp();

  beforeEach(() => {
    resetStatusCache();
    env.MONITOR_KEYS = [KEY_A];
  });
  afterEach(() => {
    env.MONITOR_KEYS = original;
  });

  it("menolak tanpa kunci dan dengan kunci salah", async () => {
    expect((await request(app).get("/api/monitor/status")).status).toBe(401);
    const bad = await request(app)
      .get("/api/monitor/status")
      .set("Authorization", `Bearer ${KEY_B}`);
    expect(bad.status).toBe(401);
  });

  it("dengan kunci benar: laporan lengkap tanpa data pribadi", async () => {
    const res = await request(app)
      .get("/api/monitor/status")
      .set("Authorization", `Bearer ${KEY_A}`);
    expect([200, 503]).toContain(res.status);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(["ok", "degraded", "down"]).toContain(res.body.status);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.services).toHaveProperty("database");
    expect(res.body.services).toHaveProperty("imap");
    expect(res.body.services).toHaveProperty("smtp");
    expect(res.body.services).toHaveProperty("accountAgent");
    expect(res.body.activity.heavyParse).toEqual({ active: 0, waiting: 0 });
    // Hanya hitungan: tidak ada alamat email di mana pun dalam laporan.
    expect(JSON.stringify(res.body)).not.toMatch(/@/);
  });

  it("hasil di-cache sehingga dua panggilan beruntun memakai laporan yang sama", async () => {
    const a = await request(app)
      .get("/api/monitor/status")
      .set("Authorization", `Bearer ${KEY_A}`);
    const b = await request(app)
      .get("/api/monitor/status")
      .set("Authorization", `Bearer ${KEY_A}`);
    expect(b.body.checkedAt).toBe(a.body.checkedAt);
  });
});
