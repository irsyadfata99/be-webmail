import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { disconnectDatabase } from "../src/lib/prisma.js";

const app = createApp();

afterAll(async () => {
  await disconnectDatabase();
});

describe("app", () => {
  it("GET /health: ok dan database tersambung", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
  });

  it("rute tidak dikenal mengembalikan 404 JSON", async () => {
    const res = await request(app).get("/tidak-ada");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("body JSON rusak mengembalikan 400", async () => {
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{rusak");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("CORS hanya mengizinkan origin yang terdaftar", async () => {
    const allowed = env.CORS_ORIGIN[0]!;
    const ok = await request(app).get("/health").set("Origin", allowed);
    expect(ok.headers["access-control-allow-origin"]).toBe(allowed);
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");

    const bad = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
