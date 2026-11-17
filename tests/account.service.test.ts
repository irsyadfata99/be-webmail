import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  session: { update: vi.fn(), updateMany: vi.fn() },
  user: { update: vi.fn(), findUnique: vi.fn() },
  loginAttempt: { count: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
const imap = vi.hoisted(() => ({ verifyImapLogin: vi.fn() }));

vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));
vi.mock("../src/lib/imap.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/imap.js")>()),
  verifyImapLogin: imap.verifyImapLogin,
}));

import { decrypt } from "../src/lib/crypto.js";
import { MailServerUnavailableError } from "../src/lib/imap.js";
import { AppError } from "../src/middleware/error-handler.js";
import {
  changePassword,
  updateProfile,
  waitForMailServer,
} from "../src/modules/account/account.service.js";
import { CREDENTIAL_CONTEXT } from "../src/modules/auth/auth.service.js";

const auth = {
  sessionId: "sess-1",
  credentialEnc: "x",
  csrfTokenHash: "h",
  twoFactorVerified: true,
  user: {
    id: "user-1",
    email: "budi@contoh.id",
    displayName: "Budi",
    role: "USER" as const,
    twoFactorEnabled: false,
  },
};
const req = { ip: "10.0.0.1", get: () => undefined } as unknown as Request;
const body = { currentPassword: "Sandi Lama 123!", newPassword: "Sandi Baru 4567!" };

function makeAgent() {
  return {
    list: vi.fn(),
    create: vi.fn(),
    setPassword: vi.fn().mockResolvedValue(undefined),
    setQuota: vi.fn(),
    setActive: vi.fn(),
    remove: vi.fn(),
  };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("seharusnya gagal");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.loginAttempt.count.mockResolvedValue(0);
  db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  db.session.update.mockResolvedValue({});
  db.session.updateMany.mockResolvedValue({ count: 2 });
  imap.verifyImapLogin.mockResolvedValue("ok");
});

describe("changePassword", () => {
  it("berhasil: agent menulis password baru, sesi ini diperbarui, sesi lain dicabut", async () => {
    const agent = makeAgent();
    const r = await changePassword(req, auth, agent, body);

    expect(r).toEqual({ sessionsRevoked: 2, mailServerReady: true });
    expect(imap.verifyImapLogin).toHaveBeenCalledWith(
      "budi@contoh.id",
      body.currentPassword,
    );
    expect(agent.setPassword).toHaveBeenCalledWith(
      "budi@contoh.id",
      body.newPassword,
    );
    // Menunggu mail server menerima password baru sebelum sesi dipindahkan.
    expect(imap.verifyImapLogin).toHaveBeenLastCalledWith(
      "budi@contoh.id",
      body.newPassword,
    );

    const upd = db.session.update.mock.calls[0]![0];
    expect(upd.where).toEqual({ id: "sess-1" });
    expect(decrypt(upd.data.credentialEnc, CREDENTIAL_CONTEXT)).toBe(
      body.newPassword,
    );

    const many = db.session.updateMany.mock.calls[0]![0];
    expect(many.where).toEqual({
      userId: "user-1",
      revokedAt: null,
      id: { not: "sess-1" },
    });
    expect(many.data.revokedAt).toBeInstanceOf(Date);

    expect(db.loginAttempt.deleteMany).toHaveBeenCalledWith({
      where: { email: "pw:budi@contoh.id", success: false },
    });
    const audit = db.auditLog.create.mock.calls.at(-1)![0].data;
    expect(audit.action).toBe("PASSWORD_CHANGED");
    expect(audit.metadata).toEqual({ sessionsRevoked: 2, mailServerReady: true });
    // Password tidak boleh bocor ke audit.
    expect(JSON.stringify(audit)).not.toContain("Sandi");
  });

  it("password saat ini salah: 400, agent tidak dipanggil, kegagalan dicatat", async () => {
    imap.verifyImapLogin.mockResolvedValue("invalid_credentials");
    const agent = makeAgent();
    const err = await failure(changePassword(req, auth, agent, body));

    expect(err.status).toBe(400);
    expect(err.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(agent.setPassword).not.toHaveBeenCalled();
    expect(db.session.update).not.toHaveBeenCalled();
    expect(db.session.updateMany).not.toHaveBeenCalled();
    expect(db.loginAttempt.create).toHaveBeenCalledWith({
      data: { email: "pw:budi@contoh.id", ipAddress: "10.0.0.1", success: false },
    });
    expect(db.auditLog.create.mock.calls.at(-1)![0].data.action).toBe(
      "PASSWORD_CHANGE_FAILED",
    );
  });

  it("terlalu banyak percobaan salah: 429 sebelum menyentuh mail server", async () => {
    db.loginAttempt.count.mockResolvedValue(99);
    const agent = makeAgent();
    const err = await failure(changePassword(req, auth, agent, body));

    expect(err.status).toBe(429);
    expect(imap.verifyImapLogin).not.toHaveBeenCalled();
    expect(agent.setPassword).not.toHaveBeenCalled();
  });

  it("mail server tidak bisa dihubungi: 503 dan tidak ada yang berubah", async () => {
    imap.verifyImapLogin.mockRejectedValue(new MailServerUnavailableError());
    const agent = makeAgent();
    const err = await failure(changePassword(req, auth, agent, body));

    expect(err.status).toBe(503);
    expect(err.code).toBe("MAIL_SERVER_UNAVAILABLE");
    expect(agent.setPassword).not.toHaveBeenCalled();
    expect(db.loginAttempt.create).not.toHaveBeenCalled();
  });

  it("layanan akun gagal: galatnya diteruskan, sesi tidak diubah", async () => {
    const agent = makeAgent();
    agent.setPassword.mockRejectedValue(
      new AppError(502, "AGENT_ERROR", "agent gagal"),
    );
    const err = await failure(changePassword(req, auth, agent, body));

    expect(err.status).toBe(502);
    expect(db.session.update).not.toHaveBeenCalled();
    expect(db.session.updateMany).not.toHaveBeenCalled();
    expect(db.loginAttempt.deleteMany).not.toHaveBeenCalled();
  });
});

describe("changePassword: menunggu mail server", () => {
  it("mail server belum siap sampai batas waktu: tetap berhasil dengan mailServerReady false", async () => {
    // Login dengan password lama berhasil, tetapi password baru belum diterima.
    imap.verifyImapLogin.mockImplementation(async (_e: string, p: string) =>
      p === body.currentPassword ? "ok" : "invalid_credentials",
    );
    let t = 0;
    const agent = makeAgent();
    const r = await changePassword(req, auth, agent, body, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      timeoutMs: 5_000,
      intervalMs: 1_000,
    });

    expect(r.mailServerReady).toBe(false);
    expect(r.sessionsRevoked).toBe(2);
    expect(agent.setPassword).toHaveBeenCalledOnce();
    // Sesi tetap dipindahkan ke password baru walau mail server belum siap.
    expect(db.session.update).toHaveBeenCalledOnce();
    expect(db.auditLog.create.mock.calls.at(-1)![0].data.metadata).toEqual({
      sessionsRevoked: 2,
      mailServerReady: false,
    });
  });
});

describe("waitForMailServer", () => {
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  };

  it("langsung true bila mail server sudah menerima", async () => {
    const verify = vi.fn().mockResolvedValue("ok");
    expect(await waitForMailServer("a@b.id", "x", { verify, ...clock() })).toBe(
      true,
    );
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("mengulang sampai berhasil", async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce("invalid_credentials")
      .mockResolvedValueOnce("invalid_credentials")
      .mockResolvedValueOnce("ok");
    expect(await waitForMailServer("a@b.id", "x", { verify, ...clock() })).toBe(
      true,
    );
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("menganggap mail server mati sementara sebagai belum siap, lalu menyerah di batas waktu", async () => {
    const verify = vi.fn().mockRejectedValue(new MailServerUnavailableError());
    const r = await waitForMailServer("a@b.id", "x", {
      verify,
      ...clock(),
      timeoutMs: 3_000,
      intervalMs: 1_000,
    });
    expect(r).toBe(false);
    expect(verify.mock.calls.length).toBeGreaterThan(1);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("galat tak terduga diteruskan, tidak ditelan", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("meledak"));
    await expect(
      waitForMailServer("a@b.id", "x", { verify, ...clock() }),
    ).rejects.toThrow("meledak");
  });
});

describe("updateProfile", () => {
  it("hanya mengirim kolom yang diisi dan mencatat audit tanpa isinya", async () => {
    db.user.update.mockResolvedValue({
      email: "budi@contoh.id",
      displayName: "Budi Baru",
      signature: "Salam",
      role: "USER",
      twoFactorEnabled: false,
      id: "user-1",
    });
    const r = await updateProfile(req, auth, { displayName: "Budi Baru" });

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { displayName: "Budi Baru" },
    });
    expect(r.displayName).toBe("Budi Baru");
    expect(r).not.toHaveProperty("id");
    const audit = db.auditLog.create.mock.calls.at(-1)![0].data;
    expect(audit.action).toBe("PROFILE_UPDATED");
    expect(audit.metadata).toEqual({ displayName: true, signature: false });
  });

  it("signature null menghapus tanda tangan", async () => {
    db.user.update.mockResolvedValue({
      email: "budi@contoh.id",
      displayName: "Budi",
      signature: null,
      role: "USER",
      twoFactorEnabled: false,
      id: "user-1",
    });
    await updateProfile(req, auth, { signature: null });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { signature: null },
    });
  });
});
