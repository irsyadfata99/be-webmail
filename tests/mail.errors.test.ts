import { describe, expect, it } from "vitest";
import { smtpError } from "../src/modules/mail/mail.errors.js";

describe("smtpError", () => {
  it("EAUTH berarti kredensial tidak valid (401)", () => {
    const e = smtpError({ code: "EAUTH" });
    expect(e.status).toBe(401);
    expect(e.code).toBe("MAIL_CREDENTIAL_INVALID");
  });

  it("552 dilaporkan sebagai pesan terlalu besar, bukan salah alamat", () => {
    const e = smtpError({ responseCode: 552 });
    expect(e.status).toBe(413);
    expect(e.code).toBe("MESSAGE_TOO_LARGE");
  });

  it("penolakan permanen lain dan EENVELOPE berarti penerima ditolak (422)", () => {
    expect(smtpError({ responseCode: 550 }).code).toBe("RECIPIENT_REJECTED");
    expect(smtpError({ code: "EENVELOPE" }).code).toBe("RECIPIENT_REJECTED");
  });

  it("galat lain, termasuk non-objek, menjadi 503", () => {
    expect(smtpError({ code: "ETIMEDOUT" }).code).toBe(
      "MAIL_SERVER_UNAVAILABLE",
    );
    expect(smtpError(null).status).toBe(503);
    expect(smtpError(undefined).status).toBe(503);
  });
});
