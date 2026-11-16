import { z } from "zod";
import { env } from "../../config/env.js";
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
