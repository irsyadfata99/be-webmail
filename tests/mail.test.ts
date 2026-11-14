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

  it("mengunduh lampiran tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/mail/messages/1/attachments/0");
    expect(res.status).toBe(401);
  });

  it("kirim tanpa sesi mengembalikan 401", async () => {
    const res = await request(app)
      .post("/api/mail/send")
      .send({ to: ["a@motioneggstudios.com"], text: "x" });
    expect(res.status).toBe(401);
  });

  it("draf balasan tanpa sesi mengembalikan 401", async () => {
    const res = await request(app)
      .get("/api/mail/messages/1/draft")
      .query({ mode: "reply" });
    expect(res.status).toBe(401);
  });

  it("kirim multipart tanpa sesi mengembalikan 401", async () => {
    const res = await request(app)
      .post("/api/mail/send")
      .field(
        "payload",
        JSON.stringify({ to: ["a@motioneggstudios.com"], text: "x" }),
      )
      .attach("attachments", Buffer.from("isi"), "catatan.txt");
    expect(res.status).toBe(401);
  });

  it("simpan draf tanpa sesi mengembalikan 401", async () => {
    const res = await request(app)
      .post("/api/mail/drafts")
      .send({ subject: "x" });
    expect(res.status).toBe(401);
  });

  it("membuka draf tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/mail/drafts/1");
    expect(res.status).toBe(401);
  });

  it("menghapus draf tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).delete("/api/mail/drafts/1");
    expect(res.status).toBe(401);
  });

  it("aksi kelola dan pencarian tanpa sesi mengembalikan 401", async () => {
    const body = { folder: "INBOX", uids: [1] };
    const results = await Promise.all([
      request(app)
        .patch("/api/mail/messages/flags")
        .send({ ...body, add: ["seen"] }),
      request(app)
        .post("/api/mail/messages/move")
        .send({ ...body, toRole: "trash" }),
      request(app).post("/api/mail/messages/delete").send(body),
      request(app).post("/api/mail/folders/empty").send({ folder: "Trash" }),
      request(app).get("/api/mail/search").query({ q: "rapat" }),
      request(app).get("/api/mail/messages/1/thread"),
    ]);
    for (const res of results) expect(res.status).toBe(401);
  });

  it("membuka satu pesan tanpa sesi mengembalikan 401", async () => {
    const res = await request(app).get("/api/mail/messages/1");
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
        size: number;
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

      const bad = await agent.get("/api/mail/messages/abc");
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("VALIDATION_ERROR");

      const none = await agent
        .get("/api/mail/messages/4000000000")
        .query({ folder: "INBOX" });
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("MESSAGE_NOT_FOUND");

      // Pesan besar (hasil uji batas 50 MB) dilewati: mengunduhnya berulang membuat tes ini kehabisan waktu.
      const first = msgs.find((m) => m.size < 1_000_000);
      if (first) {
        const one = await agent
          .get(`/api/mail/messages/${first.uid}`)
          .query({ folder: "INBOX" });
        expect(one.status).toBe(200);
        expect(one.headers["cache-control"]).toContain("no-store");
        expect(one.body.uid).toBe(first.uid);
        expect(one.body.seen).toBe(first.seen);
        expect(Array.isArray(one.body.attachments)).toBe(true);
        expect(typeof one.body.blockedImages).toBe("number");
        expect(one.body.html ?? "").not.toMatch(/<script/i);

        const reply = await agent
          .get(`/api/mail/messages/${first.uid}/draft`)
          .query({ folder: "INBOX", mode: "reply" });
        expect(reply.status).toBe(200);
        expect(reply.body.subject).toMatch(/^Re:/);
        expect(reply.body.original).toEqual({
          folder: "INBOX",
          uid: first.uid,
          kind: "reply",
        });
        expect(Array.isArray(reply.body.to)).toBe(true);

        const fwd = await agent
          .get(`/api/mail/messages/${first.uid}/draft`)
          .query({ folder: "INBOX", mode: "forward" });
        expect(fwd.status).toBe(200);
        expect(fwd.body.to).toEqual([]);
        expect(fwd.body.subject).toMatch(/^Fwd:/);

        const badMode = await agent
          .get(`/api/mail/messages/${first.uid}/draft`)
          .query({ mode: "bukan-mode" });
        expect(badMode.status).toBe(400);

        const noAtt = await agent
          .get(`/api/mail/messages/${first.uid}/attachments/999`)
          .query({ folder: "INBOX" });
        expect(noAtt.status).toBe(404);
        expect(noAtt.body.error.code).toBe("ATTACHMENT_NOT_FOUND");

        const withFile = (one.body.attachments as Array<{ index: number }>)[0];
        if (withFile) {
          const dl = await agent
            .get(
              `/api/mail/messages/${first.uid}/attachments/${withFile.index}`,
            )
            .query({ folder: "INBOX" });
          expect(dl.status).toBe(200);
          expect(dl.headers["content-disposition"]).toContain("attachment");
          expect(dl.headers["x-content-type-options"]).toBe("nosniff");
        }
      }

      const cookies = (login.headers["set-cookie"] ??
        []) as unknown as string[];
      const csrf = cookies
        .find((c) => c.startsWith("csrf_token="))
        ?.split(";")[0]
        ?.split("=")[1];
      expect(csrf).toBeDefined();

      const noCsrf = await agent
        .post("/api/mail/send")
        .send({ to: [TEST_EMAIL], text: "x" });
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.body.error.code).toBe("CSRF_INVALID");

      const badBody = await agent
        .post("/api/mail/send")
        .set("X-CSRF-Token", csrf ?? "")
        .send({ to: [], text: "x" });
      expect(badBody.status).toBe(400);
      expect(badBody.body.error.code).toBe("VALIDATION_ERROR");

      const blocked = await agent
        .post("/api/mail/send")
        .set("X-CSRF-Token", csrf ?? "")
        .field("payload", JSON.stringify({ to: [TEST_EMAIL], text: "x" }))
        .attach("attachments", Buffer.from("MZ"), "virus.exe");
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.code).toBe("ATTACHMENT_TYPE_BLOCKED");

      const noPayload = await agent
        .post("/api/mail/send")
        .set("X-CSRF-Token", csrf ?? "")
        .attach("attachments", Buffer.from("isi"), "catatan.txt");
      expect(noPayload.status).toBe(400);
      expect(noPayload.body.error.code).toBe("VALIDATION_ERROR");

      // Mengirim email sungguhan ke diri sendiri; hanya jalan bila TEST_SEND=1.
      if (process.env.TEST_SEND === "1") {
        const sent = await agent
          .post("/api/mail/send")
          .set("X-CSRF-Token", csrf ?? "")
          .send({
            to: [TEST_EMAIL],
            subject: `Tes webmail ${stamp}`,
            html: "<p>Tes kirim <b>otomatis</b></p><script>alert(1)</script>",
          });
        expect(sent.status).toBe(201);
        expect(sent.body.accepted).toContain(TEST_EMAIL);
        expect(sent.body.sentCopy).toBe(true);

        const withFile = await agent
          .post("/api/mail/send")
          .set("X-CSRF-Token", csrf ?? "")
          .field(
            "payload",
            JSON.stringify({
              to: [TEST_EMAIL],
              subject: `Tes lampiran ${stamp}`,
              text: "Lihat lampiran",
            }),
          )
          .attach("attachments", Buffer.from("isi catatan"), "catatan.txt");
        expect(withFile.status).toBe(201);
        expect(withFile.body.accepted).toContain(TEST_EMAIL);
      }

      const out = await agent.post("/api/auth/logout");
      expect(out.status).toBe(204);

      const after = await agent.get("/api/mail/folders");
      expect(after.status).toBe(401);
    },
    30_000,
  );
});
