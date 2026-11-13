import { describe, expect, it } from "vitest";
import {
  allRecipients,
  buildMailOptions,
  htmlToText,
} from "../src/modules/mail/mail.compose.js";
import { sendBody } from "../src/modules/mail/mail.schema.js";

const base = { to: ["Siti@Contoh.id"], text: "Halo" };

describe("sendBody", () => {
  it("menormalkan huruf kecil dan mengisi nilai bawaan", () => {
    const r = sendBody.parse(base);
    expect(r.to).toEqual(["siti@contoh.id"]);
    expect(r.cc).toEqual([]);
    expect(r.bcc).toEqual([]);
    expect(r.subject).toBe("");
    expect(r.references).toEqual([]);
  });

  it("menolak penerima kosong, alamat salah, dan isi kosong", () => {
    expect(sendBody.safeParse({ to: [], text: "a" }).success).toBe(false);
    expect(sendBody.safeParse({ to: ["bukan-email"], text: "a" }).success).toBe(
      false,
    );
    expect(sendBody.safeParse({ to: ["a@x.id"] }).success).toBe(false);
    expect(sendBody.safeParse({ to: ["a@x.id"], text: "   " }).success).toBe(
      false,
    );
  });

  it("menolak baris baru di subjek (header injection)", () => {
    expect(
      sendBody.safeParse({ ...base, subject: "Halo\r\nBcc: x@y.id" }).success,
    ).toBe(false);
  });

  it("membatasi total penerima unik 50", () => {
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@contoh.id`);
    expect(
      sendBody.safeParse({ to: many.slice(0, 50), cc: [many[50]], text: "a" })
        .success,
    ).toBe(false);
    expect(
      sendBody.safeParse({ to: many.slice(0, 50), text: "a" }).success,
    ).toBe(true);
    // Alamat yang sama di to dan cc dihitung satu.
    expect(
      sendBody.safeParse({ to: many.slice(0, 50), cc: [many[0]], text: "a" })
        .success,
    ).toBe(true);
  });

  it("forwardAttachments hanya untuk pesan terusan", () => {
    const original = { folder: "INBOX", uid: 1 };
    expect(
      sendBody.safeParse({ ...base, forwardAttachments: true }).success,
    ).toBe(false);
    expect(
      sendBody.safeParse({
        ...base,
        forwardAttachments: true,
        original: { ...original, kind: "reply" },
      }).success,
    ).toBe(false);
    expect(
      sendBody.safeParse({
        ...base,
        forwardAttachments: true,
        original: { ...original, kind: "forward" },
      }).success,
    ).toBe(true);
  });

  it("menolak Message-ID balasan yang tidak berformat <...>", () => {
    expect(
      sendBody.safeParse({ ...base, inReplyTo: "tanpa-kurung" }).success,
    ).toBe(false);
    expect(
      sendBody.safeParse({
        ...base,
        inReplyTo: "<a@x>",
        references: ["<a@x>", "<b@x>"],
      }).success,
    ).toBe(true);
  });
});

describe("buildMailOptions", () => {
  const sender = {
    address: "budi@motioneggstudios.com",
    displayName: 'Budi "Bos" <x>',
  };

  it("From selalu dari sesi dan nama dibersihkan", () => {
    const o = buildMailOptions(
      sendBody.parse(base),
      sender,
      "motioneggstudios.com",
    );
    expect(o.from).toEqual({
      name: "Budi Bos x",
      address: "budi@motioneggstudios.com",
    });
    expect(String(o.messageId)).toMatch(/^<[0-9a-f-]+@motioneggstudios\.com>$/);
  });

  it("membersihkan HTML dan membuat teks bila hanya HTML", () => {
    const o = buildMailOptions(
      sendBody.parse({
        to: ["a@x.id"],
        html: "<p>Halo <b>dunia</b></p><script>alert(1)</script>",
      }),
      sender,
      "motioneggstudios.com",
    );
    expect(String(o.html)).not.toMatch(/script|alert/i);
    expect(o.text).toContain("Halo dunia");
  });

  it("menyertakan cc, bcc, dan header balasan", () => {
    const o = buildMailOptions(
      sendBody.parse({
        ...base,
        cc: ["c@x.id"],
        bcc: ["d@x.id"],
        inReplyTo: "<a@x>",
        references: ["<a@x>"],
      }),
      sender,
      "motioneggstudios.com",
    );
    expect(o.cc).toEqual(["c@x.id"]);
    expect(o.bcc).toEqual(["d@x.id"]);
    expect(o.inReplyTo).toBe("<a@x>");
    expect(o.references).toEqual(["<a@x>"]);
  });
});

describe("allRecipients dan htmlToText", () => {
  it("menggabungkan penerima unik", () => {
    expect(
      allRecipients({
        to: ["a@x.id", "b@x.id"],
        cc: ["a@x.id"],
        bcc: ["c@x.id"],
      }),
    ).toEqual(["a@x.id", "b@x.id", "c@x.id"]);
  });

  it("htmlToText membuang tag dan memulihkan entitas", () => {
    expect(htmlToText("<p>A &amp; B</p>")).toBe("A & B");
  });
});
