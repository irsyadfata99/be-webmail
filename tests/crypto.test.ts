import { describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  generateToken,
  hashToken,
  safeEqual,
} from "../src/lib/crypto.js";

describe("crypto", () => {
  it("enkripsi lalu dekripsi menghasilkan teks awal", () => {
    const secret = "p@ss:word/dengan simbol ✓";
    expect(decrypt(encrypt(secret, "ctx"), "ctx")).toBe(secret);
  });

  it("hasil enkripsi berbeda tiap kali (IV acak)", () => {
    expect(encrypt("sama")).not.toBe(encrypt("sama"));
  });

  it("gagal didekripsi jika konteks berbeda", () => {
    expect(() => decrypt(encrypt("a", "x"), "y")).toThrow();
  });

  it("gagal didekripsi jika data diubah", () => {
    const parts = encrypt("rahasia").split(":");
    const data = parts[3] ?? "";
    parts[3] = (data[0] === "A" ? "B" : "A") + data.slice(1);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("token acak unik dan hash-nya konsisten", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).toHaveLength(43);
    expect(t1).not.toBe(t2);
    expect(hashToken(t1)).toBe(hashToken(t1));
    expect(hashToken(t1)).not.toBe(hashToken(t2));
    expect(hashToken(t1)).toHaveLength(64);
  });

  it("safeEqual membandingkan dengan benar", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
