import { describe, expect, it } from "vitest";
import {
  passwordChangeBody,
  profileBody,
  SIGNATURE_MAX,
} from "../src/modules/account/account.schema.js";

describe("profileBody", () => {
  it("menerima nama saja, tanda tangan saja, atau keduanya", () => {
    expect(profileBody.safeParse({ displayName: "Budi Santoso" }).success).toBe(
      true,
    );
    expect(profileBody.safeParse({ signature: "Salam,\nBudi" }).success).toBe(
      true,
    );
    expect(
      profileBody.safeParse({ displayName: "Budi", signature: "Salam" })
        .success,
    ).toBe(true);
  });

  it("menolak body tanpa kolom yang boleh diubah", () => {
    expect(profileBody.safeParse({}).success).toBe(false);
    expect(profileBody.safeParse({ email: "x@y.id" }).success).toBe(false);
  });

  it("nama: dipangkas, tidak boleh kosong, maksimal 80, tanpa karakter kontrol", () => {
    const ok = profileBody.parse({ displayName: "  Budi  " });
    expect(ok.displayName).toBe("Budi");
    expect(profileBody.safeParse({ displayName: "   " }).success).toBe(false);
    expect(profileBody.safeParse({ displayName: "a".repeat(81) }).success).toBe(
      false,
    );
    expect(profileBody.safeParse({ displayName: "a".repeat(80) }).success).toBe(
      true,
    );
    expect(profileBody.safeParse({ displayName: "Bu\ndi" }).success).toBe(false);
    expect(profileBody.safeParse({ displayName: "Bu\0di" }).success).toBe(false);
  });

  it("tanda tangan: baris baru dirapikan ke LF dan spasi akhir baris dibuang", () => {
    const r = profileBody.parse({ signature: "Salam,  \r\nBudi \t\r\n\r\n" });
    expect(r.signature).toBe("Salam,\nBudi");
  });

  it("tanda tangan kosong, hanya spasi, atau null berarti dihapus (null)", () => {
    expect(profileBody.parse({ signature: "" }).signature).toBeNull();
    expect(profileBody.parse({ signature: "  \n " }).signature).toBeNull();
    expect(profileBody.parse({ signature: null }).signature).toBeNull();
  });

  it("tanda tangan: batas panjang dan karakter kontrol", () => {
    expect(
      profileBody.safeParse({ signature: "a".repeat(SIGNATURE_MAX) }).success,
    ).toBe(true);
    expect(
      profileBody.safeParse({ signature: "a".repeat(SIGNATURE_MAX + 1) })
        .success,
    ).toBe(false);
    expect(profileBody.safeParse({ signature: "ok\0bahaya" }).success).toBe(
      false,
    );
    expect(profileBody.safeParse({ signature: "ok\u001bbahaya" }).success).toBe(
      false,
    );
  });
});

describe("passwordChangeBody", () => {
  const good = { currentPassword: "Sandi Lama 123!", newPassword: "Sandi Baru 4567!" };

  it("menerima password baru yang memenuhi syarat", () => {
    expect(passwordChangeBody.safeParse(good).success).toBe(true);
  });

  it("menolak password baru yang terlalu pendek, terlalu panjang, atau berisi baris baru", () => {
    for (const newPassword of ["pendek1!", "x".repeat(129), "Sandi\nBaru 12345!"]) {
      expect(
        passwordChangeBody.safeParse({ ...good, newPassword }).success,
      ).toBe(false);
    }
  });

  it("menolak password baru yang sama dengan yang lama", () => {
    const r = passwordChangeBody.safeParse({
      currentPassword: good.newPassword,
      newPassword: good.newPassword,
    });
    expect(r.success).toBe(false);
  });

  it("password saat ini wajib diisi", () => {
    expect(
      passwordChangeBody.safeParse({ ...good, currentPassword: "" }).success,
    ).toBe(false);
    expect(
      passwordChangeBody.safeParse({ newPassword: good.newPassword }).success,
    ).toBe(false);
  });
});
