import { describe, expect, it } from "vitest";
import {
  extractAllAttachments,
  extractAttachment,
  parseRawMessage,
} from "../src/modules/mail/mail.parse.js";
import { sanitizeEmailHtml } from "../src/modules/mail/mail.sanitize.js";

describe("sanitizeEmailHtml", () => {
  it("membuang script, iframe, form, style, dan event handler", () => {
    const { html } = sanitizeEmailHtml(
      `<p onclick="x()">Halo</p><script>alert(1)</script><iframe src="https://e.com"></iframe>` +
        `<form action="https://e.com"><input name="a"></form><style>p{color:red}</style>`,
      false,
    );
    expect(html).toContain("<p>Halo</p>");
    expect(html).not.toMatch(
      /script|iframe|<form|<input|<style|onclick|alert/i,
    );
  });

  it("membuang javascript: pada tautan dan membuka tautan aman di tab baru", () => {
    const { html } = sanitizeEmailHtml(
      `<a href="javascript:alert(1)">x</a><a href="https://contoh.id/a">ok</a>`,
      false,
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://contoh.id/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("membuang url() dan properti berbahaya di style inline, menjaga yang kosmetik", () => {
    const { html } = sanitizeEmailHtml(
      `<p style="color:#ff0000;background-image:url(https://e.com/p.png);position:fixed">a</p>`,
      false,
    );
    expect(html).toContain("color:#ff0000");
    expect(html).not.toMatch(/url\(|background-image|position/i);
  });

  it("membuang nilai negatif di style agar isi email tidak menimpa tampilan aplikasi", () => {
    const { html } = sanitizeEmailHtml(
      `<p style="margin:-9999px;width:-50px;padding:8px">a</p>`,
      false,
    );
    expect(html).toContain("padding:8px");
    expect(html).not.toMatch(/margin|width|-9999|-50/i);
  });

  it("memblokir gambar eksternal secara bawaan dan menghitungnya", () => {
    const input = `<img src="https://pelacak.example/p.gif" alt="a"><img src="//pelacak.example/q.gif"><img src="cid:logo@x">`;
    const blocked = sanitizeEmailHtml(input, false);
    expect(blocked.blockedImages).toBe(2);
    expect(blocked.html).not.toContain("pelacak.example");
    expect(blocked.html).not.toContain("cid:");
  });

  it("menulis ulang cid: ke URL lampiran, atau membuangnya bila tidak ketemu", () => {
    const { html } = sanitizeEmailHtml(
      `<img src="cid:logo@x"><img src="cid:hilang@x">`,
      false,
      (cid) =>
        cid === "logo@x" ? "/api/mail/messages/1/attachments/0?inline=1" : null,
    );
    expect(html).toContain("/api/mail/messages/1/attachments/0?inline=1");
    expect(html).not.toContain("cid:");
  });

  it("mengizinkan gambar eksternal bila diminta", () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      `<img src="https://cdn.example/a.png">`,
      true,
    );
    expect(blockedImages).toBe(0);
    expect(html).toContain("https://cdn.example/a.png");
  });

  it("membuang data: selain gambar", () => {
    const { html } = sanitizeEmailHtml(
      `<img src="data:text/html;base64,PHNjcmlwdD4="><img src="data:image/png;base64,iVBORw0KGgo=">`,
      false,
    );
    expect(html).not.toContain("text/html");
    expect(html).toContain("data:image/png");
  });
});

const raw = [
  "From: Budi <budi@contoh.id>",
  "To: Siti <siti@motioneggstudios.com>, rudi@contoh.id",
  "Cc: tim@contoh.id",
  "Subject: Rapat besok",
  "Date: Thu, 12 Nov 2026 08:00:00 +0000",
  "Message-ID: <abc@contoh.id>",
  "In-Reply-To: <prev@contoh.id>",
  "References: <a@x> <prev@contoh.id>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="B1"',
  "",
  "--B1",
  'Content-Type: multipart/alternative; boundary="B2"',
  "",
  "--B2",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Halo, teks biasa.",
  "--B2",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Halo <b>html</b></p><script>alert(1)</script><img src="https://pelacak.example/p.gif">',
  "--B2--",
  "--B1",
  'Content-Type: application/pdf; name="laporan.pdf"',
  'Content-Disposition: attachment; filename="laporan.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--B1--",
  "",
].join("\r\n");

describe("parseRawMessage", () => {
  it("mengurai header, teks, HTML tersanitasi, dan lampiran", async () => {
    const m = await parseRawMessage(Buffer.from(raw), false);
    expect(m.subject).toBe("Rapat besok");
    expect(m.from).toEqual([{ name: "Budi", address: "budi@contoh.id" }]);
    expect(m.to.map((a) => a.address)).toEqual([
      "siti@motioneggstudios.com",
      "rudi@contoh.id",
    ]);
    expect(m.cc.map((a) => a.address)).toEqual(["tim@contoh.id"]);
    expect(m.date).toBe("2026-11-12T08:00:00.000Z");
    expect(m.messageId).toBe("<abc@contoh.id>");
    expect(m.inReplyTo).toBe("<prev@contoh.id>");
    expect(m.references).toEqual(["<a@x>", "<prev@contoh.id>"]);
    expect(m.text).toContain("teks biasa");
    expect(m.html).toContain("<b>html</b>");
    expect(m.html).not.toMatch(/script|pelacak/i);
    expect(m.blockedImages).toBe(1);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({
      index: 0,
      filename: "laporan.pdf",
      contentType: "application/pdf",
      inline: false,
    });
  });
});

const rawInline = [
  "From: a@contoh.id",
  "To: b@motioneggstudios.com",
  "Subject: Logo",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="R1"',
  "",
  "--R1",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Logo:</p><img src="cid:logo@contoh.id">',
  "--R1",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo@contoh.id>",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  "iVBORw0KGgo=",
  "--R1--",
  "",
].join("\r\n");

describe("gambar tertanam (cid)", () => {
  it("ditulis ulang ke endpoint lampiran dan ditandai inline", async () => {
    const m = await parseRawMessage(
      Buffer.from(rawInline),
      false,
      (i) => `/lampiran/${i}`,
    );
    expect(m.html).toContain('src="/lampiran/0"');
    expect(m.attachments[0]).toMatchObject({
      inline: true,
      cid: "logo@contoh.id",
    });
  });
});

describe("extractAttachment", () => {
  it("mengembalikan isi lampiran, atau null untuk indeks yang tidak ada", async () => {
    const a = await extractAttachment(Buffer.from(raw), 0);
    expect(a?.filename).toBe("laporan.pdf");
    expect(a?.contentType).toBe("application/pdf");
    expect(a?.content.subarray(0, 4).toString()).toBe("%PDF");
    expect(await extractAttachment(Buffer.from(raw), 5)).toBeNull();
  });
});

describe("extractAllAttachments", () => {
  it("mengambil lampiran biasa dan melewati gambar tertanam", async () => {
    const all = await extractAllAttachments(Buffer.from(raw));
    expect(all.map((a) => a.filename)).toEqual(["laporan.pdf"]);
    expect(await extractAllAttachments(Buffer.from(rawInline))).toEqual([]);
  });
});
