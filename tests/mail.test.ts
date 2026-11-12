import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { disconnectDatabase, prisma } from "../src/lib/prisma.js";

const app = createApp();

const TEST_EMAIL = process.env.TEST_EMAIL?.trim().toLowerCase();
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const hasCreds = Boolean(TEST_EMAIL && TEST_PASSWORD);

const stamp = Date.now();

afterAll(async () => {
  if (TEST_EMAIL) {
    await prisma.loginAttempt.deleteMany({ where: { email: TEST_EMAIL } });
  }
  await disconnectDatabase();
});

describe("mail (tanpa sesi)", () => {
  it("daftar folder tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/mail/folders");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("daftar pesan tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/mail/messages");
    expect(res.status).toBe(401);
  });
});

describe("mail (dengan sesi)", () => {
  it.skipIf(!hasCreds)(
    "folder dan daftar pesan, validasi, folder tidak ada, lalu ditolak setelah logout",
    async () => {
      const agent = request.agent(app);

      const login = await agent
        .post("/api/auth/login")
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
      expect(login.status).toBe(200);

      const folders = await agent.get("/api/mail/folders");
      expect(folders.status).toBe(200);
      expect(folders.headers["cache-control"]).toContain("no-store");
      const list = folders.body.folders as Array<{
        path: string;
        role: string;
        messages: number;
        unseen: number;
      }>;
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]?.role).toBe("inbox");
      expect(typeof list[0]?.messages).toBe("number");
      expect(typeof list[0]?.unseen).toBe("number");

      const page = await agent
        .get("/api/mail/messages")
        .query({ folder: "INBOX", page: 1, pageSize: 5 });
      expect(page.status).toBe(200);
      expect(page.body.folder).toBe("INBOX");
      expect(page.body.page).toBe(1);
      expect(page.body.pageSize).toBe(5);
      expect(typeof page.body.total).toBe("number");
      expect(page.body.messages.length).toBeLessThanOrEqual(5);

      const msgs = page.body.messages as Array<{
        uid: number;
        subject: string;
        from: unknown[];
        seen: boolean;
        hasAttachments: boolean;
      }>;
      for (const m of msgs) {
        expect(typeof m.uid).toBe("number");
        expect(typeof m.subject).toBe("string");
        expect(Array.isArray(m.from)).toBe(true);
        expect(typeof m.seen).toBe("boolean");
        expect(typeof m.hasAttachments).toBe("boolean");
      }
      const uids = msgs.map((m) => m.uid);
      expect(uids).toEqual([...uids].sort((a, b) => b - a));

      const invalid = await agent.get("/api/mail/messages").query({ page: 0 });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

      const tooBig = await agent
        .get("/api/mail/messages")
        .query({ pageSize: 101 });
      expect(tooBig.status).toBe(400);

      const missing = await agent
        .get("/api/mail/messages")
        .query({ folder: `tidak-ada-${stamp}` });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("FOLDER_NOT_FOUND");

      const out = await agent.post("/api/auth/logout");
      expect(out.status).toBe(204);

      const after = await agent.get("/api/mail/folders");
      expect(after.status).toBe(401);
    },
    30_000,
  );
});
