import { z } from "zod";
import { env } from "../../config/env.js";
import { DEFAULT_PAGE_SIZE } from "../mail/mail.page.js";
import { noControlChars } from "../mail/mail.schema.js";
import {
  normalizeEmail,
  parseQuota,
  passwordProblem,
} from "./admin.validate.js";

const accountEmail = z.string().transform((value, ctx) => {
  const email = normalizeEmail(value, env.MAIL_DOMAIN);
  if (!email) {
    ctx.addIssue({
      code: "custom",
      message: `email harus berada di domain ${env.MAIL_DOMAIN}`,
    });
    return z.NEVER;
  }
  return email;
});

const password = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** null menghapus kuota; selain itu 500M atau 2G. */
const quota = z.union([z.null(), z.string()]).transform((value, ctx) => {
  const parsed = parseQuota(value);
  if (!parsed.ok) {
    ctx.addIssue({
      code: "custom",
      message: "kuota harus seperti 500M atau 2G, atau null",
    });
    return z.NEVER;
  }
  return parsed.value;
});

const displayName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(noControlChars, "nama tidak valid");

export const accountParams = z.object({ email: accountEmail });

export const createAccountBody = z.object({
  email: accountEmail,
  password,
  displayName: displayName.optional(),
  quota: quota.optional(),
});

export const passwordBody = z.object({ password });

export const quotaBody = z.object({ quota });

export const patchAccountBody = z
  .object({
    isActive: z.boolean().optional(),
    displayName: displayName.optional(),
  })
  .refine((b) => b.isActive !== undefined || b.displayName !== undefined, {
    message: "isi isActive atau displayName",
    path: ["isActive"],
  });

export type CreateAccountBody = z.infer<typeof createAccountBody>;
export type PatchAccountBody = z.infer<typeof patchAccountBody>;

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const queryDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "tanggal tidak valid");

/** Filter log audit; semua opsional. `to` berupa tanggal saja mencakup seluruh hari itu. */
export const auditLogsQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
    actor: accountEmail.optional(),
    target: accountEmail.optional(),
    action: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "action tidak valid")
      .optional(),
    from: queryDate.optional(),
    to: queryDate.optional(),
  })
  .transform((q, ctx) => {
    const from = q.from ? new Date(q.from) : undefined;
    let to: Date | undefined;
    let toInclusive = true;
    if (q.to) {
      to = new Date(q.to);
      if (dateOnly.test(q.to)) {
        to.setUTCDate(to.getUTCDate() + 1);
        toInclusive = false;
      }
    }
    if (from && to && from >= to) {
      ctx.addIssue({
        code: "custom",
        message: "from harus lebih awal dari to",
        path: ["from"],
      });
      return z.NEVER;
    }
    return { ...q, from, to, toInclusive };
  });

export type AuditLogsQuery = z.infer<typeof auditLogsQuery>;
