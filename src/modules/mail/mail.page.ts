/**
 * Pagination ala Gmail: label "1–50 dari 1.234" dan tombol Lebih baru / Lebih lama.
 * Fungsi murni. Urutan daftar selalu dari yang terbaru.
 */

/** Pilihan ukuran halaman di pengaturan Gmail. API menerima 1–100; frontend menawarkan pilihan ini. */
export const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50, 100] as const;

/** Bawaan Gmail. */
export const DEFAULT_PAGE_SIZE = 50;

export interface PageInfo {
  total: number;
  page: number;
  pageSize: number;
  /** Posisi pesan pertama di halaman ini (mulai dari 1), atau 0 bila halaman kosong. */
  start: number;
  /** Posisi pesan terakhir di halaman ini, atau 0 bila halaman kosong. */
  end: number;
  /** Ada halaman berikutnya (lebih lama). */
  hasNext: boolean;
  /** Ada halaman sebelumnya (lebih baru). */
  hasPrev: boolean;
}

export function pageInfo(
  total: number,
  page: number,
  pageSize: number,
): PageInfo {
  const first = (page - 1) * pageSize + 1;
  const empty = total < 1 || first > total;
  return {
    total,
    page,
    pageSize,
    start: empty ? 0 : first,
    end: empty ? 0 : Math.min(total, page * pageSize),
    hasNext: !empty && page * pageSize < total,
    hasPrev: page > 1,
  };
}
