import type { AgentAccount } from "./agent.client.js";

/** Bentuk baris pengguna dari database yang dipakai tampilan admin. */
export interface UserRow {
  displayName: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
}

export interface AccountView {
  email: string;
  quota: string | null;
  displayName: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  /** false bila akun ada di mailserver tetapi belum pernah login ke webmail. */
  registered: boolean;
}

export const localPart = (email: string): string =>
  email.split("@")[0] ?? email;

/** Menggabungkan akun mailserver dengan baris database (bila ada). */
export function toAccountView(
  account: AgentAccount,
  user: UserRow | undefined,
  adminEmails: readonly string[],
): AccountView {
  return {
    email: account.email,
    quota: account.quota,
    displayName: user?.displayName ?? localPart(account.email),
    role:
      user?.role ?? (adminEmails.includes(account.email) ? "ADMIN" : "USER"),
    isActive: user?.isActive ?? true,
    twoFactorEnabled: user?.twoFactorEnabled ?? false,
    lastLoginAt: user?.lastLoginAt?.toISOString() ?? null,
    registered: user !== undefined,
  };
}
