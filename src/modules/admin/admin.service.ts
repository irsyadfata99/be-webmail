import type { Request } from "express";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import type { AgentAccount, AgentApi } from "./agent.client.js";
import type { CreateAccountBody, PatchAccountBody } from "./admin.schema.js";
import { type AccountView, localPart, toAccountView } from "./admin.view.js";

const roleFor = (email: string): "ADMIN" | "USER" =>
  env.ADMIN_EMAILS.includes(email) ? "ADMIN" : "USER";

function assertNotSelf(actor: Express.AuthContext, email: string): void {
  if (actor.user.email === email) {
    throw new AppError(
      400,
      "CANNOT_MODIFY_SELF",
      "Anda tidak dapat melakukan ini pada akun Anda sendiri",
    );
  }
}

async function findAccount(
  agent: AgentApi,
  email: string,
): Promise<AgentAccount> {
  const found = (await agent.list()).find((a) => a.email === email);
  if (!found) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "Akun tidak ditemukan");
  }
  return found;
}

/** Mencabut semua sesi aktif milik `email`; mengembalikan jumlahnya. */
async function revokeSessions(email: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { user: { email }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function listAccounts(agent: AgentApi): Promise<AccountView[]> {
  const accounts = await agent.list();
  const users = await prisma.user.findMany({
    where: { email: { in: accounts.map((a) => a.email) } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return accounts
    .map((a) => toAccountView(a, byEmail.get(a.email), env.ADMIN_EMAILS))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function createAccount(
  req: Request,
  actor: Express.AuthContext,
  agent: AgentApi,
  body: CreateAccountBody,
): Promise<{ account: AccountView; quotaApplied: boolean }> {
  await agent.create(body.email, body.password);

  // Kuota gagal tidak membatalkan akun yang sudah terbuat; hasilnya dilaporkan.
  let quota: string | null = null;
  let quotaApplied = true;
  if (body.quota) {
    try {
      await agent.setQuota(body.email, body.quota);
      quota = body.quota;
    } catch (err) {
      quotaApplied = false;
      req.log.warn({ err }, "akun dibuat, tetapi kuota gagal diterapkan");
    }
  }

  const user = await prisma.user.upsert({
    where: { email: body.email },
    create: {
      email: body.email,
      displayName: body.displayName ?? localPart(body.email),
      role: roleFor(body.email),
    },
    update: body.displayName ? { displayName: body.displayName } : {},
  });

  await writeAudit(req, {
    actorId: actor.user.id,
    action: "ADMIN_ACCOUNT_CREATE",
    targetEmail: body.email,
    metadata: { quota, quotaApplied },
  });

  return {
    account: toAccountView(
      { email: body.email, quota },
      user,
      env.ADMIN_EMAILS,
    ),
    quotaApplied,
  };
}

export async function resetPassword(
  req: Request,
  actor: Express.AuthContext,
  agent: AgentApi,
  email: string,
  password: string,
): Promise<{ email: string; sessionsRevoked: number }> {
  await agent.setPassword(email, password);
  // Sesi lama menyimpan password lama terenkripsi, jadi harus dicabut.
  const sessionsRevoked = await revokeSessions(email);
  await writeAudit(req, {
    actorId: actor.user.id,
    action: "ADMIN_PASSWORD_RESET",
    targetEmail: email,
    metadata: { sessionsRevoked },
  });
  return { email, sessionsRevoked };
}

export async function setQuota(
  req: Request,
  actor: Express.AuthContext,
  agent: AgentApi,
  email: string,
  quota: string | null,
): Promise<{ email: string; quota: string | null }> {
  await agent.setQuota(email, quota);
  await writeAudit(req, {
    actorId: actor.user.id,
    action: "ADMIN_QUOTA_SET",
    targetEmail: email,
    metadata: { quota },
  });
  return { email, quota };
}

export async function patchAccount(
  req: Request,
  actor: Express.AuthContext,
  agent: AgentApi,
  email: string,
  body: PatchAccountBody,
): Promise<{ account: AccountView; sessionsRevoked: number }> {
  if (body.isActive === false) assertNotSelf(actor, email);
  const mailbox = await findAccount(agent, email);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      displayName: body.displayName ?? localPart(email),
      role: roleFor(email),
      isActive: body.isActive ?? true,
    },
    update: {
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {}),
    },
  });

  const sessionsRevoked =
    body.isActive === false ? await revokeSessions(email) : 0;

  if (body.isActive !== undefined) {
    await writeAudit(req, {
      actorId: actor.user.id,
      action: body.isActive ? "ADMIN_ACCOUNT_ENABLE" : "ADMIN_ACCOUNT_DISABLE",
      targetEmail: email,
      metadata: { sessionsRevoked },
    });
  }
  if (body.displayName !== undefined) {
    await writeAudit(req, {
      actorId: actor.user.id,
      action: "ADMIN_ACCOUNT_RENAME",
      targetEmail: email,
      metadata: { displayName: body.displayName },
    });
  }

  return {
    account: toAccountView(mailbox, user, env.ADMIN_EMAILS),
    sessionsRevoked,
  };
}

/** Menghapus akun dari mailserver dan database. Isi surelnya tetap ada di disk mailserver. */
export async function deleteAccount(
  req: Request,
  actor: Express.AuthContext,
  agent: AgentApi,
  email: string,
): Promise<{ email: string }> {
  assertNotSelf(actor, email);
  await agent.remove(email);
  // Sesi ikut terhapus (cascade); audit log tetap ada dengan actorId kosong bila ia pelakunya.
  await prisma.user.deleteMany({ where: { email } });
  await writeAudit(req, {
    actorId: actor.user.id,
    action: "ADMIN_ACCOUNT_DELETE",
    targetEmail: email,
  });
  return { email };
}
