import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { auditWhere } from "../src/modules/admin/admin.audit.js";
import { auditLogsQuery } from "../src/modules/admin/admin.schema.js";

const D = env.MAIL_DOMAIN;

describe("auditLogsQuery", () => {
  it("bawaan: halaman 1, 50 per halaman, tanpa filter", () => {
    const q = auditLogsQuery.parse({});
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(50);
    expect(q.actor).toBeUndefined();
    expect(auditWhere(q)).toEqual({});
  });

  it("menerima filter dan melengkapi email dengan domain", () => {
    const q = auditLogsQuery.parse({
      actor: "Admin",
      target: `budi@${D}`,
      action: "ADMIN_ACCOUNT_DISABLE",
      pageSize: "20",
      page: "2",
    });
    expect(q.actor).toBe(`admin@${D}`);
    expect(auditWhere(q)).toEqual({
      actor: { email: `admin@${D}` },
      targetEmail: `budi@${D}`,
      action: "ADMIN_ACCOUNT_DISABLE",
    });
    expect(q.page).toBe(2);
    expect(q.pageSize).toBe(20);
  });

  it("to berupa tanggal saja mencakup seluruh hari itu (batas atas eksklusif)", () => {
    const q = auditLogsQuery.parse({ from: "2026-11-01", to: "2026-11-16" });
    const where = auditWhere(q);
    expect(where.createdAt).toEqual({
      gte: new Date("2026-11-01T00:00:00.000Z"),
      lt: new Date("2026-11-17T00:00:00.000Z"),
    });
  });

  it("to berupa waktu lengkap dipakai apa adanya (inklusif)", () => {
    const q = auditLogsQuery.parse({ to: "2026-11-16T05:00:00Z" });
    expect(auditWhere(q).createdAt).toEqual({
      lte: new Date("2026-11-16T05:00:00Z"),
    });
  });

  it("menolak ukuran halaman di luar 1–100, tanggal salah, rentang terbalik, dan action ngawur", () => {
    for (const bad of [
      { pageSize: 0 },
      { pageSize: 101 },
      { page: 0 },
      { from: "bukan-tanggal" },
      { from: "2026-11-16", to: "2026-11-01" },
      { action: "admin; drop" },
      { actor: "a@gmail.com" },
    ]) {
      expect(auditLogsQuery.safeParse(bad).success).toBe(false);
    }
  });
});
