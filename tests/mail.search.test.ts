import { describe, expect, it } from "vitest";
import {
  MAX_CRITERIA,
  hasCriteria,
  parseSearchQuery,
  toImapSearches,
} from "../src/modules/mail/mail.search.js";

describe("parseSearchQuery", () => {
  it("memecah teks bebas menjadi kata yang semuanya harus cocok", () => {
    expect(parseSearchQuery("rapat mingguan").terms).toEqual([
      "rapat",
      "mingguan",
    ]);
  });

  it("frasa dalam kutip dihitung satu kata", () => {
    expect(parseSearchQuery('"rapat mingguan" jadwal').terms).toEqual([
      "rapat mingguan",
      "jadwal",
    ]);
  });

  it("mengenali from:, to:, dan subject: termasuk nilai berkutip", () => {
    const p = parseSearchQuery('from:ani to:budi subject:"laporan q3"');
    expect(p.from).toEqual(["ani"]);
    expect(p.to).toEqual(["budi"]);
    expect(p.subject).toEqual(["laporan q3"]);
    expect(p.terms).toEqual([]);
  });

  it("operator tidak peka huruf besar-kecil", () => {
    expect(parseSearchQuery("FROM:Ani").from).toEqual(["Ani"]);
  });

  it("mengenali has:attachment dan is:...", () => {
    const p = parseSearchQuery("has:attachment is:unread is:starred");
    expect(p.hasAttachment).toBe(true);
    expect(p.seen).toBe(false);
    expect(p.flagged).toBe(true);
    expect(parseSearchQuery("is:read").seen).toBe(true);
    expect(parseSearchQuery("is:unstarred").flagged).toBe(false);
  });

  it("membaca tanggal dengan tanda hubung atau garis miring", () => {
    const p = parseSearchQuery("after:2026-11-01 before:2026/11/13");
    expect(p.after?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(p.before?.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  it("tanggal yang tidak valid dan operator asing menjadi teks biasa", () => {
    expect(parseSearchQuery("after:kemarin").terms).toEqual(["after:kemarin"]);
    expect(parseSearchQuery("after:2026-02-31").terms).toEqual([
      "after:2026-02-31",
    ]);
    expect(parseSearchQuery("http://contoh.id").terms).toEqual([
      "http://contoh.id",
    ]);
    expect(parseSearchQuery("has:gambar").terms).toEqual(["has:gambar"]);
    expect(parseSearchQuery("is:aneh").terms).toEqual(["is:aneh"]);
  });

  it("operator bernilai kosong diabaikan", () => {
    const p = parseSearchQuery("from: subject:");
    expect(p.from).toEqual([]);
    expect(p.subject).toEqual([]);
    expect(hasCriteria(p)).toBe(false);
  });

  it("kutip tunggal yang tidak ditutup tidak merusak pencarian", () => {
    expect(parseSearchQuery('"rapat').terms).toEqual(["rapat"]);
  });

  it("membatasi jumlah kriteria", () => {
    const many = Array.from({ length: 50 }, (_, i) => `kata${i}`).join(" ");
    expect(parseSearchQuery(many).terms.length).toBeLessThanOrEqual(
      MAX_CRITERIA,
    );
  });
});

describe("toImapSearches", () => {
  it("menggabungkan flag dan tanggal, memisahkan sisanya", () => {
    const p = parseSearchQuery(
      "is:unread after:2026-11-01 from:ani from:budi laporan",
    );
    const s = toImapSearches(p);
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ seen: false, since: p.after });
    expect(s.slice(1)).toEqual([
      { from: "ani" },
      { from: "budi" },
      { text: "laporan" },
    ]);
  });

  it("flagged dan before dipetakan", () => {
    const p = parseSearchQuery("is:starred before:2026-11-13");
    expect(toImapSearches(p)).toEqual([{ flagged: true, before: p.before }]);
  });
});

describe("hasCriteria", () => {
  it("has:attachment saja sudah cukup", () => {
    expect(hasCriteria(parseSearchQuery("has:attachment"))).toBe(true);
  });

  it("tanpa kriteria nyata dianggap kosong", () => {
    expect(hasCriteria(parseSearchQuery('""'))).toBe(false);
    expect(hasCriteria(parseSearchQuery("   "))).toBe(false);
  });
});
