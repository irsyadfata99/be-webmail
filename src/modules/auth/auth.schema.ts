import { z } from "zod";
import { env } from "../../config/env.js";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

export function isCompanyEmail(email: string): boolean {
  return email.endsWith(`@${env.MAIL_DOMAIN}`);
}
