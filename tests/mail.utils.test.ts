import { describe, expect, it } from "vitest";
import {
  type FolderInfo,
  folderRole,
  hasAttachment,
  pageRange,
  sortFolders,
  toAddresses,
  toIso,
} from "../src/modules/mail/mail.utils.js";

const folder = (path: string, role: FolderInfo["role"]): FolderInfo => ({
  path,
  name: path,
  delimiter: "/",
  role,
  messages: 0,
  unseen: 0,
  subscribed: true,
});

describe("pageRange", () => {
  it("halaman 1 berisi pesan terbaru", () => {
    expect(pageRange(60, 1, 25)).toEqual({ low: 36, high: 60 });
  });

  it("halaman berikutnya turun, dan halaman terakhir dipotong di 1", () => {
    expect(pageRange(60, 2, 25)).toEqual({ low: 11, high: 35 });
    expect(pageRange(60, 3, 25)).toEqual({ low: 1, high: 10 });
  });

  it("mengembalikan null untuk kotak kosong atau halaman di luar batas", () => {
    expect(pageRange(0, 1, 25)).toBeNull();
    expect(pageRange(60, 4, 25)).toBeNull();
  });

  it("satu halaman penuh persis tidak menghasilkan halaman kedua", () => {
    expect(pageRange(25, 1, 25)).toEqual({ low: 1, high: 25 });
    expect(pageRange(25, 2, 25)).toBeNull();
  });
});

describe("folderRole", () => {
  it("INBOX selalu inbox, tanpa peduli huruf besar-kecil", () => {
    expect(folderRole("INBOX")).toBe("inbox");
    expect(folderRole("inbox")).toBe("inbox");
  });

  it("memakai atribut SPECIAL-USE bila ada", () => {
    expect(folderRole("Kirim", "\\Sent", "Kirim")).toBe("sent");
    expect(folderRole("Sampah", "\\Trash", "Sampah")).toBe("trash");
  });

  it("cadangan lewat nama folder bila atribut tidak ada", () => {
    expect(folderRole("Sent", undefined, "Sent")).toBe("sent");
    expect(folderRole("INBOX.Junk", undefined, "Junk")).toBe("junk");
    expect(folderRole("Proyek", undefined, "Proyek")).toBe("other");
  });
});

describe("sortFolders", () => {
  it("INBOX dulu, folder khusus berurutan, sisanya A-Z", () => {
    const sorted = sortFolders([
      folder("Zeta", "other"),
      folder("Trash", "trash"),
      folder("Alpha", "other"),
      folder("Sent", "sent"),
      folder("INBOX", "inbox"),
      folder("Drafts", "drafts"),
      folder("Junk", "junk"),
    ]);
    expect(sorted.map((f) => f.path)).toEqual([
      "INBOX",
      "Drafts",
      "Sent",
      "Junk",
      "Trash",
      "Alpha",
      "Zeta",
    ]);
  });

  it("tidak mengubah array asli", () => {
    const input = [folder("B", "other"), folder("A", "other")];
    sortFolders(input);
    expect(input.map((f) => f.path)).toEqual(["B", "A"]);
  });
});

describe("hasAttachment", () => {
  it("mendeteksi lampiran di bagian bersarang", () => {
    expect(
      hasAttachment({
        childNodes: [
          { childNodes: [{ disposition: undefined }] },
          { disposition: "attachment" },
        ],
      }),
    ).toBe(true);
    expect(
      hasAttachment({
        childNodes: [{ childNodes: [{ disposition: "Attachment" }] }],
      }),
    ).toBe(true);
  });

  it("gambar inline dan teks biasa bukan lampiran", () => {
    expect(hasAttachment({ childNodes: [{ disposition: "inline" }, {}] })).toBe(
      false,
    );
    expect(hasAttachment({})).toBe(false);
    expect(hasAttachment(undefined)).toBe(false);
  });
});

describe("toAddresses dan toIso", () => {
  it("membuang alamat kosong dan mengisi nama kosong", () => {
    expect(
      toAddresses([
        { name: "Budi", address: "budi@x.id" },
        { address: "a@x.id" },
        { name: "Tanpa" },
      ]),
    ).toEqual([
      { name: "Budi", address: "budi@x.id" },
      { name: "", address: "a@x.id" },
    ]);
    expect(toAddresses(undefined)).toEqual([]);
  });

  it("mengambil tanggal valid pertama", () => {
    expect(toIso(undefined, "bukan-tanggal", "2026-11-12T08:00:00Z")).toBe(
      "2026-11-12T08:00:00.000Z",
    );
    expect(toIso(null, undefined)).toBeNull();
  });
});
