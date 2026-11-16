import { z } from "zod";
import {
  RECOVERY_CODE_PATTERN,
  normalizeRecoveryCode,
} from "./twofactor.codes.js";

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "kode harus 6 digit");

export const enableBody = z.object({ code: totpCode });

/** Faktor kedua: kode dari aplikasi autentikator, atau satu kode pemulihan (salah satunya). */
export const factorBody = z
  .object({
    code: totpCode.optional(),
    recoveryCode: z
      .string()
      .trim()
      .max(40)
      .transform(normalizeRecoveryCode)
      .pipe(
        z.string().regex(RECOVERY_CODE_PATTERN, "kode pemulihan tidak valid"),
      )
      .optional(),
  })
  .refine((b) => (b.code === undefined) !== (b.recoveryCode === undefined), {
    message: "isi salah satu: code atau recoveryCode",
    path: ["code"],
  });

export type FactorInput = z.infer<typeof factorBody>;
