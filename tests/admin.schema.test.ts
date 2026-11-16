import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import {
  accountParams,
  createAccountBody,
  passwordBody,
  patchAccountBody,
  quotaBody,
} from "../src/modules/admin/admin.schema.js";

const D = env.MAIL_DOMAIN;
const PASS = "kata-sandi-panjang-123";

describe("createAccountBody", () => {
  it("menerima bagian lokal saja dan melengkapinya dengan domain", () => {
    const r = createAccountBody.parse({ email: "Budi", password: PASS });
    expect(r.email).toBe(`budi@${D}`);
    expect(r.quota).toBeUndefined();
    expect(r.displayName).toBeUndefined();
  });

  it("menerima nama tampilan dan kuota (huruf besar-kecil dirapikan)", () => {
    const r = createAccountBody.parse({
      email: `siti@${D}`,
      password: PASS,
      displayName: "  Siti Rahma ",
      quota: "2g",
    });
    expect(r.displayName).toBe("Siti Rahma");
    expect(r.quota).toBe("2G");
  });

  it("menolak domain lain, password pendek, dan kuota salah", () => {
    expect(
      createAccountBody.safeParse({ email: "a@gmail.com", password: PASS })
        .success,
    ).toBe(false);
    expect(
      createAccountBody.safeParse({ email: "a", password: "pendek" }).success,
    ).toBe(false);
    expect(
      createAccountBody.safeParse({ email: "a", password: PASS, quota: "9T" })
        .success,
    ).toBe(false);
  });

  it("menolak nama tampilan kosong atau berisi karakter kontrol", () => {
    for (const displayName of ["   ", "Siti\nRahma"]) {
      expect(
        createAccountBody.safeParse({ email: "a", password: PASS, displayName })
          .success,
      ).toBe(false);
    }
  });
});

describe("passwordBody dan quotaBody", () => {
  it("password wajib dan memenuhi syarat", () => {
    expect(passwordBody.safeParse({}).success).toBe(false);
    expect(passwordBody.safeParse({ password: PASS }).success).toBe(true);
  });

  it("kuota wajib ada; null berarti tanpa batas", () => {
    expect(quotaBody.safeParse({}).success).toBe(false);
    expect(quotaBody.parse({ quota: null }).quota).toBeNull();
    expect(quotaBody.parse({ quota: "500m" }).quota).toBe("500M");
    expect(quotaBody.safeParse({ quota: "abc" }).success).toBe(false);
  });
});

describe("patchAccountBody", () => {
  it("minimal satu bidang harus diisi", () => {
    expect(patchAccountBody.safeParse({}).success).toBe(false);
    expect(patchAccountBody.safeParse({ isActive: false }).success).toBe(true);
    expect(patchAccountBody.safeParse({ displayName: "Budi" }).success).toBe(
      true,
    );
  });

  it("isActive harus boolean", () => {
    expect(patchAccountBody.safeParse({ isActive: "false" }).success).toBe(
      false,
    );
  });
});

describe("accountParams", () => {
  it("menormalkan email dari path dan menolak domain lain", () => {
    expect(accountParams.parse({ email: `Budi@${D}` }).email).toBe(`budi@${D}`);
    expect(accountParams.safeParse({ email: "budi@gmail.com" }).success).toBe(
      false,
    );
  });
});
