import { z } from "zod";
import { passwordProblem } from "../admin/admin.validate.js";
import { noControlChars } from "../mail/mail.schema.js";

export const SIGNATURE_MAX = 2000;

const displayName = z
  .string()
  .trim()
  .min(1, "nama tampilan tidak boleh kosong")
  .max(80, "nama tampilan maksimal 80 karakter")
  .refine(noControlChars, "nama tampilan tidak valid");

// Boleh beberapa baris dan tab, tetapi tanpa karakter kontrol lain.
const BAD_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** String kosong atau hanya spasi disimpan sebagai null (tanda tangan dihapus). */
const signature = z
  .string()
  .max(SIGNATURE_MAX, `tanda tangan maksimal ${SIGNATURE_MAX} karakter`)
  .refine((v) => !BAD_CONTROL.test(v), "tanda tangan tidak valid")
  .transform((v) => {
    const clean = v
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
    return clean === "" ? null : clean;
  })
  .nullable();

export const profileBody = z
  .object({
    displayName: displayName.optional(),
    signature: signature.optional(),
  })
  .refine((b) => b.displayName !== undefined || b.signature !== undefined, {
    message: "isi displayName atau signature",
    path: ["displayName"],
  });

export const passwordChangeBody = z
  .object({
    currentPassword: z.string().min(1, "password saat ini wajib diisi").max(256),
    newPassword: z.string().superRefine((value, ctx) => {
      const problem = passwordProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  })
  .refine((b) => b.currentPassword !== b.newPassword, {
    message: "password baru harus berbeda dari password saat ini",
    path: ["newPassword"],
  });

export type ProfileBody = z.infer<typeof profileBody>;
export type PasswordChangeBody = z.infer<typeof passwordChangeBody>;
