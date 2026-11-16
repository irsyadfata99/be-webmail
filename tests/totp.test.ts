import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUri,
  totpAt,
  verifyTotp,
} from "../src/lib/totp.js";

// Vektor uji RFC 6238 (kunci "12345678901234567890", SHA-1, 8 digit).
const SECRET = base32Encode(Buffer.from("12345678901234567890"));
const VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totp", () => {
  it.each(VECTORS)("cocok dengan vektor RFC 6238 pada t=%i", (t, expected) => {
    expect(totpAt(SECRET, t * 1000, 8)).toBe(expected);
    expect(totpAt(SECRET, t * 1000, 6)).toBe(expected.slice(-6));
  });

  it("base32 bolak-balik untuk berbagai panjang", () => {
    for (let n = 1; n <= 24; n++) {
      const bytes = Buffer.from(
        Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255),
      );
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
  });

  it("generateSecret menghasilkan rahasia base32 yang berbeda tiap kali", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/);
    expect(a).not.toBe(b);
  });

  const now = 1111111111 * 1000;
  const step = Math.floor(now / 30000);

  it("menerima kode saat ini dan satu langkah sebelumnya, menolak dua langkah", () => {
    expect(verifyTotp(SECRET, totpAt(SECRET, now), now)).toBe(step);
    expect(verifyTotp(SECRET, totpAt(SECRET, now - 30000), now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpAt(SECRET, now - 60000), now)).toBeNull();
  });

  it("menolak pemakaian ulang langkah yang sama", () => {
    const code = totpAt(SECRET, now);
    expect(verifyTotp(SECRET, code, now, { lastStep: step })).toBeNull();
    expect(verifyTotp(SECRET, code, now, { lastStep: step - 1 })).toBe(step);
  });

  it("menolak format yang salah", () => {
    expect(verifyTotp(SECRET, "12345", now)).toBeNull();
    expect(verifyTotp(SECRET, "abcdef", now)).toBeNull();
    expect(verifyTotp(SECRET, "1234567", now)).toBeNull();
  });

  it("otpauthUri memuat penerbit, akun, dan rahasia", () => {
    const uri = otpauthUri({
      secret: SECRET,
      account: "budi@contoh.id",
      issuer: "contoh.id",
    });
    expect(uri.startsWith("otpauth://totp/contoh.id:budi%40contoh.id?")).toBe(
      true,
    );
    expect(uri).toContain(`secret=${SECRET}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
