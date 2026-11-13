import { describe, expect, it } from "vitest";
import {
  type OriginalMessage,
  buildComposeDraft,
  buildReferences,
  replyRecipients,
  subjectWithPrefix,
} from "../src/modules/mail/mail.reply.js";

const me = "siti@motioneggstudios.com";

const original: OriginalMessage = {
  subject: "Rapat besok",
  from: [{ name: "Budi", address: "budi@contoh.id" }],
  to: [
    { name: "Siti", address: "Siti@MotionEggStudios.com" },
    { name: "", address: "rudi@contoh.id" },
  ],
  cc: [
    { name: "", address: "tim@contoh.id" },
    { name: "", address: "RUDI@contoh.id" },
  ],
  replyTo: [],
  date: "2026-11-12T08:00:00.000Z",
  messageId: "<abc@contoh.id>",
  references: ["<a@x>", "<prev@contoh.id>"],
  text: "Baris satu\nBaris dua",
  html: "<p>Baris <b>satu</b></p>",
};

describe("subjectWithPrefix", () => {
  it("menambah satu awalan dan tidak menumpuk", () => {
    expect(subjectWithPrefix("Rapat", "Re:")).toBe("Re: Rapat");
    expect(subjectWithPrefix("RE: Re: Rapat", "Re:")).toBe("Re: Rapat");
    expect(subjectWithPrefix("Fwd: Rapat", "Fwd:")).toBe("Fwd: Rapat");
    expect(subjectWithPrefix("Fw: Re: Rapat", "Re:")).toBe("Re: Rapat");
    expect(subjectWithPrefix("", "Re:")).toBe("Re:");
  });
});

describe("replyRecipients", () => {
  it("balas hanya ke pengirim", () => {
    expect(replyRecipients(original, me, "reply")).toEqual({
      to: ["budi@contoh.id"],
      cc: [],
    });
  });

  it("Reply-To didahulukan dari From", () => {
    const o = {
      ...original,
      replyTo: [{ name: "", address: "bantuan@contoh.id" }],
    };
    expect(replyRecipients(o, me, "reply").to).toEqual(["bantuan@contoh.id"]);
  });

  it("balas semua: sisa penerima ke Cc tanpa diri sendiri dan tanpa duplikat", () => {
    expect(replyRecipients(original, me, "replyAll")).toEqual({
      to: ["budi@contoh.id"],
      cc: ["rudi@contoh.id", "tim@contoh.id"],
    });
  });

  it("pesan dari diri sendiri dibalas ke penerima aslinya", () => {
    const mine = {
      ...original,
      from: [{ name: "Siti", address: "SITI@motioneggstudios.com" }],
    };
    expect(replyRecipients(mine, me, "reply").to).toEqual(["rudi@contoh.id"]);
  });
});

describe("buildReferences", () => {
  it("menambahkan Message-ID asli dan membatasi 20 terakhir", () => {
    expect(buildReferences(original)).toEqual([
      "<a@x>",
      "<prev@contoh.id>",
      "<abc@contoh.id>",
    ]);
    const long = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`);
    const refs = buildReferences({ references: long, messageId: "<baru@x>" });
    expect(refs).toHaveLength(20);
    expect(refs.at(-1)).toBe("<baru@x>");
  });
});

describe("buildComposeDraft", () => {
  it("balas: subjek, header balasan, dan kutipan", () => {
    const d = buildComposeDraft(original, "reply", me);
    expect(d.subject).toBe("Re: Rapat besok");
    expect(d.inReplyTo).toBe("<abc@contoh.id>");
    expect(d.references).toContain("<abc@contoh.id>");
    expect(d.text).toContain("Budi <budi@contoh.id> menulis:");
    expect(d.text).toContain("> Baris satu");
    expect(d.html).toContain("<blockquote>");
    expect(d.html).toContain("<b>satu</b>");
  });

  it("teruskan: tanpa penerima, tanpa header balasan, dengan blok pesan terusan", () => {
    const d = buildComposeDraft(original, "forward", me);
    expect(d.subject).toBe("Fwd: Rapat besok");
    expect(d.to).toEqual([]);
    expect(d.inReplyTo).toBeUndefined();
    expect(d.references).toEqual([]);
    expect(d.text).toContain("Pesan terusan");
    expect(d.text).toContain("Subjek: Rapat besok");
  });

  it("nama pengirim di HTML di-escape", () => {
    const o = {
      ...original,
      from: [{ name: "<img src=x onerror=1>", address: "a@x.id" }],
    };
    const d = buildComposeDraft(o, "reply", me);
    expect(d.html).not.toContain("<img src=x");
    expect(d.html).toContain("&lt;img");
  });

  it("pesan tanpa HTML memakai teks yang di-escape", () => {
    const d = buildComposeDraft(
      { ...original, html: null, text: "a < b" },
      "reply",
      me,
    );
    expect(d.html).toContain("a &lt; b");
  });
});
