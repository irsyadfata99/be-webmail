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
