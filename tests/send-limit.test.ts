import type { Request } from "express";
import { afterAll, describe, expect, it } from "vitest";
import { disconnectDatabase, prisma } from "../src/lib/prisma.js";
import { AppError } from "../src/middleware/error-handler.js";
import { SENDS_PER_HOUR } from "../src/modules/mail/mail.compose.js";
import { reserveSendSlot } from "../src/modules/mail/mail.send.js";

// Tes ini memakai database dev (seperti app.test.ts) tetapi tidak mengirim email.
const email = `send-limit-${Date.now()}@example.test`;
const fakeReq = {
  ip: "127.0.0.1",
  get: () => "vitest",
} as unknown as Request;

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await disconnectDatabase();
});

describe("reserveSendSlot", () => {
  it("permintaan paralel tidak bisa melewati batas per jam", async () => {
    const user = await prisma.user.create({
      data: { email, displayName: "send-limit" },
    });

    const attempts = SENDS_PER_HOUR + 12;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => reserveSendSlot(fakeReq, user.id)),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    expect(ok).toHaveLength(SENDS_PER_HOUR);
    expect(rejected).toHaveLength(attempts - SENDS_PER_HOUR);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect((r.reason as AppError).code).toBe("SEND_LIMIT_REACHED");
    }

    const stored = await prisma.auditLog.count({
      where: { actorId: user.id, action: "MAIL_SENT" },
    });
    expect(stored).toBe(SENDS_PER_HOUR);
  });
});
