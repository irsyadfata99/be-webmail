import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageInfo,
} from "../src/modules/mail/mail.page.js";

describe("pageInfo (ala Gmail)", () => {
  it("halaman pertama: 1–50 dari 120, ada yang lebih lama, tidak ada yang lebih baru", () => {
    expect(pageInfo(120, 1, 50)).toEqual({
      total: 120,
      page: 1,
      pageSize: 50,
      start: 1,
      end: 50,
      hasNext: true,
      hasPrev: false,
    });
  });

  it("halaman tengah dan terakhir", () => {
    expect(pageInfo(120, 2, 50)).toMatchObject({
      start: 51,
      end: 100,
      hasNext: true,
      hasPrev: true,
    });
    expect(pageInfo(120, 3, 50)).toMatchObject({
      start: 101,
      end: 120,
      hasNext: false,
      hasPrev: true,
    });
  });

  it("jumlah pas kelipatan halaman tidak menyisakan halaman kosong", () => {
    expect(pageInfo(100, 2, 50)).toMatchObject({
      start: 51,
      end: 100,
      hasNext: false,
    });
    expect(pageInfo(50, 1, 50)).toMatchObject({
      start: 1,
      end: 50,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("folder kosong", () => {
    expect(pageInfo(0, 1, 50)).toEqual({
      total: 0,
      page: 1,
      pageSize: 50,
      start: 0,
      end: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("halaman di luar rentang kosong, tetapi masih bisa kembali ke halaman lebih baru", () => {
    expect(pageInfo(120, 9, 50)).toEqual({
      total: 120,
      page: 9,
      pageSize: 50,
      start: 0,
      end: 0,
      hasNext: false,
      hasPrev: true,
    });
  });

  it("satu pesan saja", () => {
    expect(pageInfo(1, 1, 10)).toMatchObject({
      start: 1,
      end: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("bawaan dan pilihan ukuran sama dengan Gmail", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect([...PAGE_SIZE_OPTIONS]).toEqual([10, 15, 20, 25, 50, 100]);
  });
});
