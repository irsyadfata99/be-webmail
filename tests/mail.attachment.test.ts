import { describe, expect, it } from "vitest";
import {
  MAX_TOTAL_ATTACHMENT_BYTES,
  checkOutgoingAttachments,
  checkTotalBytes,
  fixFilenameEncoding,
  isBlockedExtension,
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

describe("isBlockedExtension", () => {
  it("menolak ekstensi berbahaya, tanpa peduli huruf besar-kecil", () => {
    expect(isBlockedExtension("virus.exe")).toBe(true);
    expect(isBlockedExtension("Skrip.PS1")).toBe(true);
    expect(isBlockedExtension("laporan.pdf.scr")).toBe(true);
  });

  it("mengizinkan berkas biasa", () => {
    expect(isBlockedExtension("laporan.pdf")).toBe(false);
    expect(isBlockedExtension("catatan")).toBe(false);
    expect(isBlockedExtension("a.exe.txt")).toBe(false);
  });
});

describe("fixFilenameEncoding", () => {
  it("memulihkan nama UTF-8 yang terbaca sebagai latin1", () => {
    const garbled = Buffer.from("Laporan é.pdf", "utf8").toString("latin1");
    expect(fixFilenameEncoding(garbled)).toBe("Laporan é.pdf");
  });

  it("tidak mengubah nama ASCII atau yang sudah UTF-8", () => {
    expect(fixFilenameEncoding("laporan.pdf")).toBe("laporan.pdf");
    expect(fixFilenameEncoding("日本語.pdf")).toBe("日本語.pdf");
  });
});

describe("checkOutgoingAttachments dan checkTotalBytes", () => {
  const max = 10 * 1024 * 1024;

  it("lolos untuk berkas wajar", () => {
    expect(
      checkOutgoingAttachments([{ filename: "a.pdf", size: 1000 }], max),
    ).toBeNull();
  });

  it("menolak ekstensi terlarang, berkas terlalu besar, dan terlalu banyak berkas", () => {
    expect(
      checkOutgoingAttachments([{ filename: "a.exe", size: 1 }], max)?.code,
    ).toBe("ATTACHMENT_TYPE_BLOCKED");
    expect(
      checkOutgoingAttachments([{ filename: "a.pdf", size: max + 1 }], max)
        ?.status,
    ).toBe(413);
    const many = Array.from({ length: 11 }, (_, i) => ({
      filename: `f${i}.txt`,
      size: 1,
    }));
    expect(checkOutgoingAttachments(many, max)?.code).toBe(
      "TOO_MANY_ATTACHMENTS",
    );
  });

  it("total ukuran dibatasi (bawaan 15 MB)", () => {
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBe(15 * 1024 * 1024);
    expect(checkTotalBytes(MAX_TOTAL_ATTACHMENT_BYTES)).toBeNull();
    expect(checkTotalBytes(MAX_TOTAL_ATTACHMENT_BYTES + 1)?.code).toBe(
      "ATTACHMENTS_TOO_LARGE",
    );
  });

  it("total ukuran mengikuti batas yang diberikan", () => {
    const max = 5 * 1024 * 1024;
    expect(checkTotalBytes(max, max)).toBeNull();
    expect(checkTotalBytes(max + 1, max)?.code).toBe("ATTACHMENTS_TOO_LARGE");
  });
});
