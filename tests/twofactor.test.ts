import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "../src/modules/auth/twofactor.codes.js";
import {
  enableBody,
  factorBody,
} from "../src/modules/auth/twofactor.schema.js";

describe("kode pemulihan", () => {
  it("berbentuk xxxxx-xxxxx tanpa karakter membingungkan", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRecoveryCode()).toMatch(
        /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/,
      );
    }
  });

  it("menghasilkan 10 kode yang unik", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("normalisasi membuang tanda hubung, spasi, dan huruf besar", () => {
    expect(normalizeRecoveryCode(" ABCDE-fghjk ")).toBe("abcdefghjk");
  });
});

describe("skema 2FA", () => {
  it("enableBody menerima 6 digit saja", () => {
    expect(enableBody.safeParse({ code: "123456" }).success).toBe(true);
    expect(enableBody.safeParse({ code: " 123456 " }).success).toBe(true);
    expect(enableBody.safeParse({ code: "12345" }).success).toBe(false);
    expect(enableBody.safeParse({ code: "abcdef" }).success).toBe(false);
    expect(enableBody.safeParse({}).success).toBe(false);
  });

  it("factorBody butuh tepat satu dari code atau recoveryCode", () => {
    expect(factorBody.safeParse({ code: "123456" }).success).toBe(true);
    expect(factorBody.safeParse({}).success).toBe(false);
    expect(
      factorBody.safeParse({ code: "123456", recoveryCode: "abcde-fghjk" })
        .success,
    ).toBe(false);
  });

  it("factorBody menormalkan kode pemulihan", () => {
    const r = factorBody.safeParse({ recoveryCode: "ABCDE-FGHJK" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.recoveryCode).toBe("abcdefghjk");
  });

  it("factorBody menolak kode pemulihan yang bentuknya salah", () => {
    expect(factorBody.safeParse({ recoveryCode: "pendek" }).success).toBe(
      false,
    );
    expect(factorBody.safeParse({ recoveryCode: "abcde-fghj!" }).success).toBe(
      false,
    );
  });
});
