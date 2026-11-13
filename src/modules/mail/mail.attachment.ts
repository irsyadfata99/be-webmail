/** Fungsi murni untuk lampiran. Tidak menyentuh jaringan. */

/** Hanya gambar raster ini yang boleh disajikan inline. SVG sengaja tidak termasuk. */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Tipe yang bisa menjalankan skrip bila dibuka browser; selalu disajikan sebagai biner. */
const ACTIVE_TYPES =
  /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;

export function isInlineImageType(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType.trim().toLowerCase());
}

/** Content-Type aman untuk unduhan: tipe aktif diganti application/octet-stream. */
export function downloadContentType(contentType: string | undefined): string {
  const type = (contentType ?? "").trim().toLowerCase();
  if (
    !type ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+/.test(type) ||
    ACTIVE_TYPES.test(type)
  ) {
    return "application/octet-stream";
  }
  return type.split(";")[0] ?? "application/octet-stream";
}

/** Nama file aman: tanpa path, karakter kontrol, atau tanda kutip; maksimal 120 karakter. */
export function safeFilename(
  name: string | undefined,
  fallback: string,
): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127 && !'"<>:|?*'.includes(ch);
    })
    .join("")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return fallback;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export function normalizeCid(cid: string | undefined | null): string {
  return (cid ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

/** Batas lampiran keluar. Ukuran per berkas mengikuti MAX_ATTACHMENT_MB di env. */
export const MAX_OUTGOING_FILES = 10;
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Ekstensi yang ditolak untuk lampiran keluar, seperti kebanyakan penyedia email. */
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "js",
  "jse",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "msi",
  "jar",
  "ps1",
  "lnk",
  "hta",
  "cpl",
  "reg",
  "dll",
]);

export function isBlockedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return BLOCKED_EXTENSIONS.has(
    filename
      .slice(dot + 1)
      .trim()
      .toLowerCase(),
  );
}

/**
 * Multer membaca nama berkas sebagai latin1, sehingga nama UTF-8 rusak.
 * Dipulihkan hanya bila semua karakter masih ≤ 0xFF dan hasilnya UTF-8 sah.
 */
export function fixFilenameEncoding(name: string): string {
  if ([...name].some((ch) => ch.charCodeAt(0) > 0xff)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}

export interface OutgoingProblem {
  status: number;
  code: string;
  message: string;
}

/** Memeriksa berkas unggahan: jumlah, ekstensi, dan ukuran per berkas. */
export function checkOutgoingAttachments(
  files: ReadonlyArray<{ filename: string; size: number }>,
  maxFileBytes: number,
): OutgoingProblem | null {
  if (files.length > MAX_OUTGOING_FILES) {
    return {
      status: 400,
      code: "TOO_MANY_ATTACHMENTS",
      message: `Maksimal ${MAX_OUTGOING_FILES} lampiran per pesan`,
    };
  }
  for (const file of files) {
    if (isBlockedExtension(file.filename)) {
      return {
        status: 400,
        code: "ATTACHMENT_TYPE_BLOCKED",
        message: `Jenis berkas tidak diizinkan: ${file.filename}`,
      };
    }
    if (file.size > maxFileBytes) {
      return {
        status: 413,
        code: "ATTACHMENT_TOO_LARGE",
        message: `Lampiran terlalu besar: ${file.filename}`,
      };
    }
  }
  return null;
}

export function checkTotalBytes(totalBytes: number): OutgoingProblem | null {
  return totalBytes > MAX_TOTAL_ATTACHMENT_BYTES
    ? {
        status: 413,
        code: "ATTACHMENTS_TOO_LARGE",
        message: "Total ukuran lampiran melebihi batas",
      }
    : null;
}
