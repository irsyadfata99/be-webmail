import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { describe, expect, it } from "vitest";
import {
  ORIGINAL_HEADER,
  buildDraftOptions,
  decodeOriginal,
  encodeOriginal,
  isEmptyDraft,
  parseSavedDraft,
  pickDraftAttachments,
} from "../src/modules/mail/mail.saved-draft.js";
import { draftBody, sendBody } from "../src/modules/mail/mail.schema.js";

const sender = { address: "admin@motioneggstudios.com", displayName: "Admin" };
const original = {
  folder: "INBOX/Proyek Baru",
  uid: 42,
  kind: "forward" as const,
};

/** Menyusun pesan mentah seperti yang disimpan ke folder Drafts. */
async function rawDraft(options: SendMailOptions): Promise<Buffer> {
  const builder = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built = (await builder.sendMail({
    ...options,
    keepBcc: true,
  } as SendMailOptions)) as unknown as { message: Buffer };
  return built.message;
}

describe("draftBody", () => {
  it("menerima draf kosong dan mengisi nilai bawaan", () => {
    const r = draftBody.parse({});
    expect(r.to).toEqual([]);
    expect(r.cc).toEqual([]);
    expect(r.bcc).toEqual([]);
    expect(r.subject).toBe("");
    expect(r.references).toEqual([]);
    expect(r.keepAttachments).toEqual([]);
    expect(r.forwardAttachments).toBe(false);
  });

  it("menormalkan penerima tetapi menolak alamat yang salah", () => {
    expect(draftBody.parse({ to: ["Siti@Contoh.id"] }).to).toEqual([
      "siti@contoh.id",
    ]);
    expect(draftBody.safeParse({ to: ["bukan-email"] }).success).toBe(false);
  });

  it("menolak baris baru di subjek (header injection)", () => {
    expect(
      draftBody.safeParse({ subject: "Halo\r\nBcc: x@y.id" }).success,
    ).toBe(false);
  });

  it("membatasi total penerima unik 50", () => {
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@contoh.id`);
    expect(
      draftBody.safeParse({ to: many.slice(0, 30), cc: many.slice(30) })
        .success,
    ).toBe(false);
    expect(draftBody.safeParse({ to: many.slice(0, 50) }).success).toBe(true);
  });

  it("keepAttachments hanya bersama replaceUid", () => {
    expect(draftBody.safeParse({ keepAttachments: [0] }).success).toBe(false);
    expect(
      draftBody.safeParse({ keepAttachments: [0], replaceUid: 7 }).success,
    ).toBe(true);
  });

  it("forwardAttachments hanya untuk pesan terusan", () => {
    expect(draftBody.safeParse({ forwardAttachments: true }).success).toBe(
      false,
    );
    expect(
      draftBody.safeParse({
        forwardAttachments: true,
        original: { ...original, kind: "reply" },
      }).success,
    ).toBe(false);
    expect(
      draftBody.safeParse({ forwardAttachments: true, original }).success,
    ).toBe(true);
  });
});

describe("sendBody dengan draf", () => {
  it("menerima referensi draf dan mengisi keepAttachments", () => {
    const r = sendBody.parse({
      to: ["a@contoh.id"],
      text: "Halo",
      draft: { uid: 9 },
    });
    expect(r.draft).toEqual({ uid: 9, keepAttachments: [] });
  });

  it("menolak uid draf yang tidak valid", () => {
    expect(
      sendBody.safeParse({
        to: ["a@contoh.id"],
        text: "Halo",
        draft: { uid: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("isEmptyDraft", () => {
  const empty = draftBody.parse({});

  it("draf tanpa isi apa pun dianggap kosong", () => {
    expect(isEmptyDraft(empty)).toBe(true);
    expect(
      isEmptyDraft({ ...empty, subject: "  ", text: " \n ", html: " " }),
    ).toBe(true);
  });

  it("satu bidang terisi sudah cukup untuk disimpan", () => {
    expect(isEmptyDraft({ ...empty, to: ["a@contoh.id"] })).toBe(false);
    expect(isEmptyDraft({ ...empty, subject: "Rapat" })).toBe(false);
    expect(isEmptyDraft({ ...empty, text: "Halo" })).toBe(false);
    expect(isEmptyDraft({ ...empty, html: "<p>Halo</p>" })).toBe(false);
  });
});

describe("encodeOriginal / decodeOriginal", () => {
  it("bolak-balik tanpa perubahan, termasuk nama folder dengan spasi dan garis miring", () => {
    expect(decodeOriginal(encodeOriginal(original))).toEqual(original);
  });

  it("tahan terhadap pelipatan header", () => {
    const folded = encodeOriginal(original).replace(/(.{20})/g, "$1\r\n ");
    expect(decodeOriginal(folded)).toEqual(original);
  });

  it("mengabaikan nilai rusak atau tidak sah", () => {
    expect(decodeOriginal(null)).toBeNull();
    expect(decodeOriginal("")).toBeNull();
    expect(decodeOriginal("bukan-base64-json")).toBeNull();
    expect(
      decodeOriginal(
        Buffer.from(
          JSON.stringify({ folder: "x", uid: -1, kind: "hapus" }),
        ).toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("buildDraftOptions", () => {
  it("pengirim selalu dari sesi dan HTML dibersihkan", () => {
    const input = draftBody.parse({
      to: ["a@contoh.id"],
      html: "<p>Halo</p><script>alert(1)</script>",
    });
    const o = buildDraftOptions(input, sender, "motioneggstudios.com");
    expect(o.from).toEqual({ name: "Admin", address: sender.address });
    expect(String(o.html)).not.toContain("<script");
    expect(String(o.messageId)).toMatch(/^<.+@motioneggstudios\.com>$/);
  });

  it("menyimpan pesan asal di header khusus, hanya bila ada", () => {
    const withOriginal = buildDraftOptions(
      draftBody.parse({ original }),
      sender,
      "motioneggstudios.com",
    );
    expect(withOriginal.headers).toEqual({
      [ORIGINAL_HEADER]: encodeOriginal(original),
    });
    const without = buildDraftOptions(
      draftBody.parse({}),
      sender,
      "motioneggstudios.com",
    );
    expect(without.headers).toBeUndefined();
  });
});

describe("parseSavedDraft", () => {
  it("draf lengkap kembali utuh: penerima, Bcc, thread, pesan asal, dan lampiran", async () => {
    const input = draftBody.parse({
      to: ["a@contoh.id"],
      cc: ["b@contoh.id"],
      bcc: ["rahasia@contoh.id"],
      subject: "Re: Rapat",
      text: "Halo semua",
      html: "<p>Halo <b>semua</b></p>",
      inReplyTo: "<asal@contoh.id>",
      references: ["<satu@contoh.id>", "<asal@contoh.id>"],
      original,
    });
    const options = buildDraftOptions(input, sender, "motioneggstudios.com");
    options.attachments = [
      {
        filename: "catatan.txt",
        content: Buffer.from("isi catatan"),
        contentType: "text/plain",
      },
      {
        filename: "data.bin",
        content: Buffer.alloc(2048, 1),
        contentType: "application/octet-stream",
      },
    ];

    const parsed = await parseSavedDraft(await rawDraft(options));
    expect(parsed.to).toEqual(["a@contoh.id"]);
    expect(parsed.cc).toEqual(["b@contoh.id"]);
    expect(parsed.bcc).toEqual(["rahasia@contoh.id"]);
    expect(parsed.subject).toBe("Re: Rapat");
    expect(parsed.text.trim()).toBe("Halo semua");
    expect(parsed.html).toContain("<b>semua</b>");
    expect(parsed.inReplyTo).toBe("<asal@contoh.id>");
    expect(parsed.references).toEqual(["<satu@contoh.id>", "<asal@contoh.id>"]);
    expect(parsed.original).toEqual(original);
    expect(
      parsed.attachments.map((a) => [a.index, a.filename, a.size]),
    ).toEqual([
      [0, "catatan.txt", 11],
      [1, "data.bin", 2048],
    ]);
  });

  it("draf tanpa penerima, subjek, dan isi tetap bisa dibangun dan dibaca", async () => {
    const options = buildDraftOptions(
      draftBody.parse({ subject: "Baru judul" }),
      sender,
      "motioneggstudios.com",
    );
    const parsed = await parseSavedDraft(await rawDraft(options));
    expect(parsed.to).toEqual([]);
    expect(parsed.subject).toBe("Baru judul");
    expect(parsed.original).toBeNull();
    expect(parsed.attachments).toEqual([]);
  });
});

describe("pickDraftAttachments", () => {
  it("mengambil lampiran menurut indeks, dan null bila ada indeks yang tidak ada", async () => {
    const options = buildDraftOptions(
      draftBody.parse({ text: "x" }),
      sender,
      "motioneggstudios.com",
    );
    options.attachments = [
      {
        filename: "a.txt",
        content: Buffer.from("AAA"),
        contentType: "text/plain",
      },
      {
        filename: "b.txt",
        content: Buffer.from("BBBB"),
        contentType: "text/plain",
      },
    ];
    const raw = await rawDraft(options);

    const picked = await pickDraftAttachments(raw, [1, 1]);
    expect(picked).toHaveLength(1);
    expect(picked?.[0]?.filename).toBe("b.txt");
    expect(picked?.[0]?.content.toString()).toBe("BBBB");

    expect(await pickDraftAttachments(raw, [0, 5])).toBeNull();
  });
});
