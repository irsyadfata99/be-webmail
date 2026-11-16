import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  parseQuota,
  passwordProblem,
} from "../src/modules/admin/admin.validate.js";

const D = "contoh.id";

describe("normalizeEmail", () => {
  it("menerima alamat lengkap dan melengkapi bagian lokal, huruf kecil", () => {
    expect(normalizeEmail("Budi@Contoh.ID", D)).toBe("budi@contoh.id");
    expect(normalizeEmail("  siti.rahma ", D)).toBe("siti.rahma@contoh.id");
  });

  it("menolak domain lain, bentuk aneh, dan bukan teks", () => {
    expect(normalizeEmail("budi@gmail.com", D)).toBeNull();
    expect(normalizeEmail("a@b@contoh.id", D)).toBeNull();
    expect(normalizeEmail("../etc@contoh.id", D)).toBeNull();
    expect(normalizeEmail("a..b@contoh.id", D)).toBeNull();
    expect(normalizeEmail("-a@contoh.id", D)).toBeNull();
    expect(normalizeEmail("", D)).toBeNull();
    expect(normalizeEmail(42, D)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@contoh.id`, D)).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("menerima password 12 sampai 128 karakter", () => {
    expect(passwordProblem("a".repeat(12))).toBeNull();
    expect(passwordProblem("a".repeat(128))).toBeNull();
  });

  it("menolak yang pendek, terlalu panjang, dan berisi baris baru atau NUL", () => {
    expect(passwordProblem("pendek")).toMatch(/minimal/);
    expect(passwordProblem("a".repeat(129))).toMatch(/maksimal/);
    expect(passwordProblem("abcdefghijk\nl")).toMatch(/baris baru/);
    expect(passwordProblem("abcdefghijk\0l")).toMatch(/baris baru/);
    expect(passwordProblem(123456789012)).toMatch(/teks/);
  });
});

describe("parseQuota", () => {
  it("menerima 500M, 2g (jadi 2G), dan null", () => {
    expect(parseQuota("500M")).toEqual({ ok: true, value: "500M" });
    expect(parseQuota(" 2g ")).toEqual({ ok: true, value: "2G" });
    expect(parseQuota(null)).toEqual({ ok: true, value: null });
  });

  it("menolak nol, tanpa satuan, satuan lain, dan bukan teks", () => {
    for (const bad of ["0M", "500", "1T", "1.5G", "", "M", 5, undefined]) {
      expect(parseQuota(bad)).toEqual({ ok: false });
    }
  });
});
