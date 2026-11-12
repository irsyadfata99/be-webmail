import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { disconnectDatabase, prisma } from "../src/lib/prisma.js";

const app = createApp();

const TEST_EMAIL = process.env.TEST_EMAIL?.trim().toLowerCase();
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const hasCreds = Boolean(TEST_EMAIL && TEST_PASSWORD);

const stamp = Date.now();
const ghost = `ghost-${stamp}@${env.MAIL_DOMAIN}`;
const foreign = `orang-${stamp}@example.org`;

afterAll(async () => {
  const emails = [ghost, foreign, ...(TEST_EMAIL ? [TEST_EMAIL] : [])];
  await prisma.loginAttempt.deleteMany({ where: { email: { in: emails } } });
  await disconnectDatabase();
});

describe("auth", () => {
  it("menolak body tidak valid (400)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "bukan-email", password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("menolak email di luar domain perusahaan dengan pesan generik", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: foreign, password: "apa-saja" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("menolak akun yang tidak ada di mail server", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: ghost, password: "salah-total" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("/me tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("logout tanpa sesi tetap 204", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
  });

  it.skipIf(!hasCreds)(
    "alur login, me, logout, dan token lama ditolak",
    async () => {
      const agent = request.agent(app);

      const res = await agent
        .post("/api/auth/login")
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(TEST_EMAIL);

      const cookies = (res.headers["set-cookie"] ?? []) as string[];
      const sid = cookies.find((c) => c.startsWith("sid="));
      const csrf = cookies.find((c) => c.startsWith("csrf_token="));
      expect(sid).toBeDefined();
      expect(sid).toMatch(/HttpOnly/i);
      expect(csrf).toBeDefined();
      expect(csrf).not.toMatch(/HttpOnly/i);

      const me = await agent.get("/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(TEST_EMAIL);

      const out = await agent.post("/api/auth/logout");
      expect(out.status).toBe(204);

      // Memutar ulang token lama harus ditolak karena sesi sudah dicabut
      const oldToken = (sid ?? "").split(";")[0] ?? "";
      const replay = await request(app)
        .get("/api/auth/me")
        .set("Cookie", oldToken);
      expect(replay.status).toBe(401);
    },
  );
});
