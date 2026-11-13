import { describe, expect, it } from "vitest";
import {
  downloadContentType,
  isInlineImageType,
  normalizeCid,
  safeFilename,
} from "../src/modules/mail/mail.attachment.js";

describe("isInlineImageType", () => {
  it("hanya gambar raster; SVG dan HTML tidak", () => {
    expect(isInlineImageType("image/png")).toBe(true);
    expect(isInlineImageType("IMAGE/JPEG")).toBe(true);
    expect(isInlineImageType("image/svg+xml")).toBe(false);
    expect(isInlineImageType("text/html")).toBe(false);
  });
});

describe("downloadContentType", () => {
  it("tipe aktif diganti octet-stream", () => {
    expect(downloadContentType("text/html; charset=utf-8")).toBe(
      "application/octet-stream",
    );
    expect(downloadContentType("image/svg+xml")).toBe(
      "application/octet-stream",
    );
    expect(downloadContentType("application/javascript")).toBe(
      "application/octet-stream",
    );
    expect(downloadContentType(undefined)).toBe("application/octet-stream");
    expect(downloadContentType("asal-asalan")).toBe("application/octet-stream");
  });

  it("tipe biasa dipertahankan tanpa parameter", () => {
    expect(downloadContentType("application/pdf")).toBe("application/pdf");
    expect(downloadContentType("Text/Plain; charset=utf-8")).toBe("text/plain");
  });
});

describe("safeFilename", () => {
  it("membuang path, kutip, karakter kontrol, dan titik di awal", () => {
    expect(safeFilename("../../etc/passwd", "x")).toBe("passwd");
    expect(safeFilename('C:\\temp\\la"por\u0001an.pdf', "x")).toBe(
      "laporan.pdf",
    );
    expect(safeFilename(".htaccess", "x")).toBe("htaccess");
  });

  it("memakai cadangan bila kosong", () => {
    expect(safeFilename("", "lampiran-0")).toBe("lampiran-0");
    expect(safeFilename(undefined, "lampiran-1")).toBe("lampiran-1");
  });

  it("memotong nama panjang tetapi menjaga ekstensi", () => {
    const out = safeFilename(`${"a".repeat(300)}.pdf`, "x");
    expect(out.length).toBe(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("normalizeCid", () => {
  it("membuang kurung sudut dan menyamakan huruf", () => {
    expect(normalizeCid("<Logo@X>")).toBe("logo@x");
    expect(normalizeCid(undefined)).toBe("");
  });
});
