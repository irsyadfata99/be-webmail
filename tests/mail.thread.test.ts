import { describe, expect, it } from "vitest";
import {
  baseSubject,
  extractIds,
  parseReferencesHeader,
  selectThread,
  threadSearchCriteria,
  threadSearchIds,
  type ThreadMeta,
} from "../src/modules/mail/mail.thread.js";

const meta = (
  uid: number,
  messageId: string | null,
  inReplyTo: string | null = null,
  references: string[] = [],
  folder = "INBOX",
): ThreadMeta => ({ folder, uid, messageId, inReplyTo, references });

describe("extractIds", () => {
  it("mengambil semua Message-ID dalam huruf kecil", () => {
    expect(extractIds("<A@x.id> <b@Y.id>")).toEqual(["<a@x.id>", "<b@y.id>"]);
    expect(extractIds(null)).toEqual([]);
    expect(extractIds("tanpa id")).toEqual([]);
  });
});

describe("parseReferencesHeader", () => {
  it("membaca header yang terlipat dari buffer", () => {
    const block = Buffer.from(
      "Subject: x\r\nReferences: <a@x.id>\r\n <b@x.id>\r\n\t<c@x.id>\r\nTo: y\r\n\r\n",
    );
    expect(parseReferencesHeader(block)).toEqual([
      "<a@x.id>",
      "<b@x.id>",
      "<c@x.id>",
    ]);
  });

  it("kosong bila header tidak ada", () => {
    expect(parseReferencesHeader("Subject: x\r\n")).toEqual([]);
    expect(parseReferencesHeader(undefined)).toEqual([]);
  });
});

describe("baseSubject", () => {
  it("membuang awalan berulang tanpa mengubah huruf", () => {
    expect(baseSubject("Re: Fwd: RE: Rapat Mingguan")).toBe("Rapat Mingguan");
    expect(baseSubject("Balas: Jadwal")).toBe("Jadwal");
    expect(baseSubject("Re[2]: Jadwal")).toBe("Jadwal");
    expect(baseSubject("Revisi anggaran")).toBe("Revisi anggaran");
  });
});

describe("threadSearchIds / threadSearchCriteria", () => {
  it("memakai akar, induk, dan pesan sendiri tanpa kembar", () => {
    expect(
      threadSearchIds(meta(1, "<c@x>", "<b@x>", ["<a@x>", "<b@x>"])),
    ).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(threadSearchIds(meta(1, "<a@x>"))).toEqual(["<a@x>"]);
    expect(threadSearchIds(meta(1, null))).toEqual([]);
  });

  it("menyusun tiga kriteria header per ID, atau null bila kosong", () => {
    expect(threadSearchCriteria([])).toBeNull();
    const c = threadSearchCriteria(["<a@x>", "<b@x>"]);
    expect(c?.or).toHaveLength(6);
  });
});

describe("selectThread", () => {
  it("mengambil balasan dan saudara, membuang pesan yang tidak terkait", () => {
    const root = meta(1, "<a@x>");
    const reply = meta(2, "<b@x>", "<a@x>", ["<a@x>"]);
    const sibling = meta(3, "<c@x>", "<a@x>", ["<a@x>"]);
    const unrelated = meta(4, "<z@x>", null, ["<q@x>"]);
    const picked = selectThread(root, [reply, sibling, unrelated]);
    expect(picked.map((m) => m.uid)).toEqual([1, 2, 3]);
  });

  it("menghubungkan rantai lewat perantara walau benih tidak langsung terkait", () => {
    const seed = meta(2, "<b@x>", "<a@x>", ["<a@x>"]);
    const grandchild = meta(3, "<c@x>", "<b@x>", ["<a@x>", "<b@x>"]);
    const root = meta(1, "<a@x>");
    expect(
      selectThread(seed, [grandchild, root])
        .map((m) => m.uid)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it("menggabungkan salinan kembar dan mendahulukan benih", () => {
    const seed = meta(7, "<a@x>", null, [], "Sent");
    const copy = meta(9, "<a@x>", null, [], "INBOX");
    const picked = selectThread(seed, [copy]);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.folder).toBe("Sent");
  });

  it("pesan tanpa Message-ID dibedakan menurut folder dan UID", () => {
    const seed = meta(1, null);
    const other = meta(1, null, null, [], "Sent");
    expect(selectThread(seed, [other])).toHaveLength(1);
  });

  it("benih tanpa kerabat menghasilkan dirinya sendiri", () => {
    const seed = meta(1, "<a@x>");
    expect(selectThread(seed, [])).toEqual([seed]);
  });
});
