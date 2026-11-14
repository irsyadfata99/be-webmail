import { describe, expect, it } from "vitest";
import {
  deleteBody,
  emptyFolderBody,
  flagsBody,
  moveBody,
  searchQuery,
  threadQuery,
} from "../src/modules/mail/mail.schema.js";

describe("flagsBody", () => {
  it("menerima add dan remove, UID kembar digabung", () => {
    const r = flagsBody.parse({
      folder: "INBOX",
      uids: [3, 3, 5],
      add: ["seen"],
    });
    expect(r.uids).toEqual([3, 5]);
    expect(r.add).toEqual(["seen"]);
    expect(r.remove).toEqual([]);
  });

  it("menolak permintaan tanpa add atau remove", () => {
    expect(flagsBody.safeParse({ folder: "INBOX", uids: [1] }).success).toBe(
      false,
    );
  });

  it("menolak flag yang sama di add dan remove", () => {
    expect(
      flagsBody.safeParse({
        folder: "INBOX",
        uids: [1],
        add: ["seen"],
        remove: ["seen"],
      }).success,
    ).toBe(false);
  });

  it("menolak flag yang tidak dikenal, UID kosong, atau lebih dari 100", () => {
    expect(
      flagsBody.safeParse({ folder: "INBOX", uids: [1], add: ["deleted"] })
        .success,
    ).toBe(false);
    expect(
      flagsBody.safeParse({ folder: "INBOX", uids: [], add: ["seen"] }).success,
    ).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(
      flagsBody.safeParse({ folder: "INBOX", uids: many, add: ["seen"] })
        .success,
    ).toBe(false);
  });

  it("folder wajib eksplisit", () => {
    expect(flagsBody.safeParse({ uids: [1], add: ["seen"] }).success).toBe(
      false,
    );
  });
});

describe("moveBody", () => {
  it("menerima salah satu dari to atau toRole", () => {
    expect(
      moveBody.safeParse({ folder: "INBOX", uids: [1], to: "Archive" }).success,
    ).toBe(true);
    expect(
      moveBody.safeParse({ folder: "INBOX", uids: [1], toRole: "spam" })
        .success,
    ).toBe(true);
  });

  it("menolak keduanya sekaligus atau tidak satu pun", () => {
    expect(
      moveBody.safeParse({
        folder: "INBOX",
        uids: [1],
        to: "Archive",
        toRole: "trash",
      }).success,
    ).toBe(false);
    expect(moveBody.safeParse({ folder: "INBOX", uids: [1] }).success).toBe(
      false,
    );
  });

  it("menolak peran yang tidak dikenal", () => {
    expect(
      moveBody.safeParse({ folder: "INBOX", uids: [1], toRole: "drafts" })
        .success,
    ).toBe(false);
  });
});

describe("deleteBody / emptyFolderBody", () => {
  it("memvalidasi folder dan UID", () => {
    expect(
      deleteBody.safeParse({ folder: "INBOX", uids: [1, 2] }).success,
    ).toBe(true);
    expect(deleteBody.safeParse({ folder: "", uids: [1] }).success).toBe(false);
    expect(deleteBody.safeParse({ folder: "INBOX", uids: [0] }).success).toBe(
      false,
    );
    expect(emptyFolderBody.safeParse({ folder: "Trash" }).success).toBe(true);
    expect(emptyFolderBody.safeParse({}).success).toBe(false);
  });

  it("menolak nama folder dengan karakter kontrol", () => {
    expect(deleteBody.safeParse({ folder: "IN\nBOX", uids: [1] }).success).toBe(
      false,
    );
  });
});

describe("searchQuery / threadQuery", () => {
  it("mengisi nilai bawaan", () => {
    const r = searchQuery.parse({ q: " rapat " });
    expect(r).toEqual({
      q: "rapat",
      folder: "INBOX",
      scope: "folder",
      page: 1,
      pageSize: 25,
    });
    expect(threadQuery.parse({}).folder).toBe("INBOX");
  });

  it("menolak q kosong atau terlalu panjang, dan scope asing", () => {
    expect(searchQuery.safeParse({ q: "  " }).success).toBe(false);
    expect(searchQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(searchQuery.safeParse({ q: "a", scope: "semua" }).success).toBe(
      false,
    );
    expect(searchQuery.safeParse({ q: "a", scope: "all" }).success).toBe(true);
  });
});
