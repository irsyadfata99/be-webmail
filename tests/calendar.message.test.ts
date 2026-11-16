import { describe, expect, it } from "vitest";
import {
  buildInvitationMessage,
  buildRsvpMessage,
  escapeHtml,
} from "../src/modules/calendar/calendar.message.js";

const base = {
  method: "REQUEST" as const,
  sequence: 0,
  title: "Rapat mingguan",
  when: "Jumat, 20 November 2026, 09.00–10.00 (Asia/Jakarta)",
  organizerName: "Ani",
  attendees: ["budi@x.id", "cici@x.id"],
};

describe("buildInvitationMessage", () => {
  it("undangan baru: subjek, tautan rapat, dan peserta", () => {
    const m = buildInvitationMessage({
      ...base,
      location: "Ruang A",
      meetUrl: "https://meet.google.com/abc-defg-hij",
      description: "Agenda: anggaran",
    });
    expect(m.subject).toBe(`Undangan: Rapat mingguan @ ${base.when}`);
    expect(m.text).toContain("Ani mengundang Anda");
    expect(m.text).toContain(
      "Tautan rapat: https://meet.google.com/abc-defg-hij",
    );
    expect(m.text).toContain("Lokasi: Ruang A");
    expect(m.text).toContain("Peserta: budi@x.id, cici@x.id");
    expect(m.html).toContain('<a href="https://meet.google.com/abc-defg-hij">');
  });

  it("pembaruan dan pembatalan memakai awalan berbeda dan tidak mencantumkan tautan rapat saat batal", () => {
    expect(
      buildInvitationMessage({ ...base, sequence: 2 }).subject.startsWith(
        "Pembaruan undangan: ",
      ),
    ).toBe(true);
    const cancel = buildInvitationMessage({
      ...base,
      method: "CANCEL",
      sequence: 3,
      meetUrl: "https://meet.google.com/a-b-c",
    });
    expect(cancel.subject.startsWith("Dibatalkan: ")).toBe(true);
    expect(cancel.text).toContain("Acara ini dibatalkan");
    expect(cancel.text).not.toContain("meet.google.com");
    expect(cancel.html).not.toContain("meet.google.com");
  });

  it("isi pengguna di HTML di-escape", () => {
    const m = buildInvitationMessage({
      ...base,
      title: "<img src=x onerror=alert(1)>",
      description: "a < b & c\nbaris dua",
    });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(m.html).toContain("a &lt; b &amp; c<br>baris dua");
  });

  it("subjek yang sangat panjang dipotong", () => {
    const m = buildInvitationMessage({ ...base, title: "x".repeat(400) });
    expect(m.subject.length).toBeLessThanOrEqual(250);
  });
});

describe("buildRsvpMessage", () => {
  it("setiap jawaban punya awalan subjek dan kalimat sendiri", () => {
    const common = { title: "Rapat", when: "W", responderName: "Budi" };
    const a = buildRsvpMessage({ ...common, response: "accepted" });
    const d = buildRsvpMessage({ ...common, response: "declined" });
    const t = buildRsvpMessage({ ...common, response: "tentative" });
    expect(a.subject).toBe("Diterima: Rapat @ W");
    expect(d.subject).toBe("Ditolak: Rapat @ W");
    expect(t.subject).toBe("Mungkin: Rapat @ W");
    expect(a.text).toContain("Budi menerima undangan ini.");
    expect(d.text).toContain("Budi menolak undangan ini.");
    expect(t.text).toContain("Budi mungkin akan hadir.");
  });

  it("komentar ikut dan di-escape", () => {
    const m = buildRsvpMessage({
      response: "accepted",
      title: "R",
      when: "W",
      responderName: "B",
      comment: "<b>siap</b>",
    });
    expect(m.text).toContain("<b>siap</b>");
    expect(m.html).toContain("&lt;b&gt;siap&lt;/b&gt;");
  });
});

describe("escapeHtml", () => {
  it("mengganti lima karakter khusus", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
