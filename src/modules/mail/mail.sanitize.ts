import sanitizeHtml from "sanitize-html";

export interface SanitizeResult {
  html: string;
  /** Jumlah gambar http(s) eksternal yang dibuang karena `allowImages` = false. */
  blockedImages: number;
}

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "h1",
  "h2",
  "font",
  "center",
  "small",
  "u",
  "s",
];

const COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i,
  /^[a-z]{3,30}$/i,
];
// Tanpa nilai negatif: margin negatif bisa menggeser isi email menimpa tampilan aplikasi.
const LENGTH = [/^\d{1,4}(\.\d{1,2})?(px|em|rem|%|pt)?$/i];

/**
 * Gaya inline: hanya properti kosmetik dengan nilai sederhana. Karena nilai
 * harus cocok dengan pola ini, `url(...)`, `expression(...)` dan `position`
 * otomatis terbuang.
 */
const ALLOWED_STYLES = {
  "*": {
    color: COLOR,
    "background-color": COLOR,
    "text-align": [/^(left|right|center|justify)$/i],
    "font-weight": [/^(normal|bold|[1-9]00)$/i],
    "font-style": [/^(normal|italic)$/i],
    "font-size": LENGTH,
    "text-decoration": [/^(none|underline|line-through)$/i],
    width: LENGTH,
    "max-width": LENGTH,
    height: LENGTH,
    margin: LENGTH,
    padding: LENGTH,
  },
};

function isExternalSrc(src: string): boolean {
  return /^(https?:)?\/\//i.test(src.trim());
}

/**
 * Membersihkan HTML email dari konten aktif. Buang script, iframe, form,
 * event handler, `<style>`, dan `url()` di style inline. Tautan dibuka di tab
 * baru dengan rel="noopener noreferrer". Gambar eksternal diblokir kecuali
 * `allowImages`; gambar `cid:` diganti URL lampiran lewat `resolveCid` (dibuang bila tidak ketemu); `data:image/` dibiarkan.
 */
export function sanitizeEmailHtml(
  html: string,
  allowImages: boolean,
  resolveCid?: (cid: string) => string | null,
): SanitizeResult {
  let blockedImages = 0;

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
      font: ["color", "size"],
      td: ["colspan", "rowspan", "align", "valign"],
      th: ["colspan", "rowspan", "align", "valign"],
      "*": ["style", "dir", "align"],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: allowImages ? ["http", "https", "cid", "data"] : ["cid", "data"],
    },
    allowProtocolRelative: allowImages,
    transformTags: {
      a: (_tag, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (_tag, attribs) => {
        const src = attribs.src ?? "";
        if (/^cid:/i.test(src)) {
          const url = resolveCid?.(src.slice(4)) ?? null;
          const { src: _removed, ...rest } = attribs;
          return {
            tagName: "img",
            attribs: url ? { ...rest, src: url } : rest,
          };
        }
        if (!allowImages && isExternalSrc(src)) {
          blockedImages += 1;
          const { src: _removed, ...rest } = attribs;
          return { tagName: "img", attribs: rest };
        }
        if (
          /^data:/i.test(src) &&
          !/^data:image\/(png|jpe?g|gif|webp);/i.test(src)
        ) {
          const { src: _removed, ...rest } = attribs;
          return { tagName: "img", attribs: rest };
        }
        return { tagName: "img", attribs };
      },
    },
  });

  return { html: clean, blockedImages };
}
