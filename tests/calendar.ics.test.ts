import { describe, expect, it } from "vitest";
import {
  buildInvitationIcs,
  buildReplyIcs,
  findInvitation,
  findMeetUrl,
  formatWhen,
  parseInvitation,
  plainText,
  safeHttpUrl,
  type IcsEvent,
} from "../src/modules/calendar/calendar.ics.js";

const organizer = { name: "Ani Wijaya", email: "ani@x.id" };
const event: IcsEvent = {
  eventUid: "uid-1@x.id",
  sequence: 0,
  title: "Rapat mingguan",
  allDay: false,
  start: new Date("2026-11-20T02:00:00Z"),
  end: new Date("2026-11-20T03:00:00Z"),
  organizer,
  location: "Ruang A",
  description: "Agenda: anggaran",
  meetUrl: "https://meet.google.com/abc-defg-hij",
};
const NOW = new Date("2026-11-14T01:00:00Z");

describe("buildInvitationIcs / parseInvitation", () => {
  it("undangan bisa dibaca kembali dengan isi yang sama", () => {
    const ics = buildInvitationIcs(
      "REQUEST",
      event,
      ["budi@x.id", "cici@x.id"],
      NOW,
    );
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20261120T020000Z");

    const inv = parseInvitation(ics)!;
    expect(inv.method).toBe("REQUEST");
    expect(inv.eventUid).toBe("uid-1@x.id");
    expect(inv.sequence).toBe(0);
    expect(inv.title).toBe("Rapat mingguan");
    expect(inv.start).toBe("2026-11-20T02:00:00.000Z");
    expect(inv.end).toBe("2026-11-20T03:00:00.000Z");
    expect(inv.allDay).toBe(false);
    expect(inv.location).toBe("Ruang A");
    expect(inv.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(inv.organizer).toEqual({ name: "Ani Wijaya", email: "ani@x.id" });
    expect(inv.attendees.map((a) => [a.email, a.status])).toEqual([
      ["budi@x.id", "needs-action"],
      ["cici@x.id", "needs-action"],
    ]);
    expect(inv.description).toContain("Agenda: anggaran");
    expect(inv.description).toContain(
      "Bergabung: https://meet.google.com/abc-defg-hij",
    );
    expect(inv.cancelled).toBe(false);
    expect(inv.canRespond).toBe(true);
  });

  it("pembatalan: METHOD:CANCEL, status batal, dan tidak bisa dibalas", () => {
    const inv = parseInvitation(
      buildInvitationIcs(
        "CANCEL",
        { ...event, sequence: 3 },
        ["budi@x.id"],
        NOW,
      ),
    )!;
    expect(inv.method).toBe("CANCEL");
    expect(inv.sequence).toBe(3);
    expect(inv.cancelled).toBe(true);
    expect(inv.canRespond).toBe(false);
  });

  it("acara sehari penuh: tanggal saja, hari terakhir inklusif", () => {
    const allDay: IcsEvent = {
      ...event,
      allDay: true,
      start: new Date("2026-11-20T00:00:00Z"),
      end: new Date("2026-11-22T00:00:00Z"),
    };
    const ics = buildInvitationIcs("REQUEST", allDay, ["budi@x.id"], NOW);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261120");
    expect(ics).toContain("DTEND;VALUE=DATE:20261123");
    const inv = parseInvitation(ics)!;
    expect(inv.allDay).toBe(true);
    expect(inv.start).toBe("2026-11-20");
    expect(inv.end).toBe("2026-11-22");
  });

  it("tanpa lokasi, tautan rapat dipakai sebagai lokasi", () => {
    const { location: _l, ...rest } = event;
    const inv = parseInvitation(
      buildInvitationIcs("REQUEST", rest, ["b@x.id"], NOW),
    )!;
    expect(inv.location).toBe("https://meet.google.com/abc-defg-hij");
    expect(inv.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("judul dengan baris baru dan koma tidak merusak berkas", () => {
    const ics = buildInvitationIcs(
      "REQUEST",
      { ...event, title: "Rapat; anggaran, Q4\r\nATTENDEE:mailto:x@jahat.id" },
      ["budi@x.id"],
      NOW,
    );
    const inv = parseInvitation(ics)!;
    expect(inv.attendees.map((a) => a.email)).toEqual(["budi@x.id"]);
    expect(inv.title).toContain("Rapat; anggaran, Q4");
  });
});

describe("buildReplyIcs", () => {
  it("balasan memuat satu peserta dengan status jawabannya", () => {
    const ics = buildReplyIcs(
      event,
      { name: "Budi", email: "budi@x.id" },
      "accepted",
      NOW,
    );
    expect(ics).toContain("METHOD:REPLY");
    const inv = parseInvitation(ics)!;
    expect(inv.method).toBe("REPLY");
    expect(inv.eventUid).toBe("uid-1@x.id");
    expect(inv.attendees).toEqual([
      { name: "Budi", email: "budi@x.id", status: "accepted" },
    ]);
    expect(inv.canRespond).toBe(false);
    for (const [response, status] of [
      ["declined", "declined"],
      ["tentative", "tentative"],
    ] as const) {
      const r = parseInvitation(
        buildReplyIcs(event, { name: null, email: "budi@x.id" }, response, NOW),
      )!;
      expect(r.attendees[0]?.status).toBe(status);
    }
  });
});

const GOOGLE_ICS = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Jakarta",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0700",
  "TZOFFSETTO:+0700",
  "TZNAME:WIB",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Asia/Jakarta:20261120T090000",
  "DTEND;TZID=Asia/Jakarta:20261120T100000",
  "DTSTAMP:20261114T010000Z",
  "ORGANIZER;CN=Ani:mailto:ANI@x.id",
  "UID:abc123@google.com",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Budi:mailto:budi@x.id",
  "ATTENDEE;PARTSTAT=ACCEPTED;CN=Ani:mailto:ani@x.id",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "SEQUENCE:2",
  "SUMMARY:Rapat <b>penting</b>",
  "LOCATION:Ruang A",
  "DESCRIPTION:Agenda\\nGabung: https://meet.google.com/abc-defg-hij",
  "STATUS:CONFIRMED",
  "RRULE:FREQ=WEEKLY;BYDAY=FR",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("parseInvitation: ICS dari Google", () => {
  it("membaca zona waktu, peserta, tautan, pengulangan, dan membersihkan HTML", () => {
    const inv = parseInvitation(GOOGLE_ICS)!;
    expect(inv.start).toBe("2026-11-20T02:00:00.000Z");
    expect(inv.end).toBe("2026-11-20T03:00:00.000Z");
    expect(inv.timezone).toBe("Asia/Jakarta");
    expect(inv.organizer).toEqual({ name: "Ani", email: "ani@x.id" });
    expect(inv.attendees.map((a) => [a.email, a.status])).toEqual([
      ["budi@x.id", "needs-action"],
      ["ani@x.id", "accepted"],
    ]);
    expect(inv.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(inv.sequence).toBe(2);
    expect(inv.recurrence).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(inv.title).toBe("Rapat penting");
    expect(inv.canRespond).toBe(true);
  });

  it("bukan ICS, tanpa acara, atau terlalu besar menghasilkan null", () => {
    expect(parseInvitation("bukan ics sama sekali")).toBeNull();
    expect(
      parseInvitation("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"),
    ).toBeNull();
    expect(parseInvitation(GOOGLE_ICS + "X".repeat(300 * 1024))).toBeNull();
  });

  it("jumlah peserta dibatasi dan alamat tidak valid dibuang", () => {
    const attendees = Array.from(
      { length: 150 },
      (_, i) => `ATTENDEE:mailto:u${i}@x.id`,
    );
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:u",
      "DTSTART:20261120T020000Z",
      "SUMMARY:x",
      "ORGANIZER:mailto:bukan-email",
      ...attendees,
      "ATTENDEE:mailto:rusak",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const inv = parseInvitation(ics)!;
    expect(inv.attendees).toHaveLength(100);
    expect(inv.organizer).toBeNull();
    expect(inv.canRespond).toBe(false);
  });

  it("aturan pengulangan yang ekstrem tidak memperlambat pembacaan", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:e",
      "DTSTART:20261120T090000Z",
      "SUMMARY:x",
      "RRULE:FREQ=SECONDLY;COUNT=999999999",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const started = Date.now();
    expect(parseInvitation(ics)?.recurrence).toBe(
      "FREQ=SECONDLY;COUNT=999999999",
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("findInvitation", () => {
  const part = (
    contentType: string,
    filename: string | undefined,
    text: string,
  ) => ({
    contentType,
    filename,
    content: Buffer.from(text),
  });

  it("mengambil dari bagian text/calendar atau lampiran .ics, melewati yang lain", () => {
    expect(findInvitation([part("image/png", "a.png", GOOGLE_ICS)])).toBeNull();
    expect(
      findInvitation([part("text/calendar", undefined, GOOGLE_ICS)])?.eventUid,
    ).toBe("abc123@google.com");
    expect(
      findInvitation([
        part("application/octet-stream", "invite.ics", GOOGLE_ICS),
      ])?.eventUid,
    ).toBe("abc123@google.com");
    expect(
      findInvitation([
        part("text/calendar", undefined, "rusak"),
        part("text/calendar", undefined, GOOGLE_ICS),
      ])?.eventUid,
    ).toBe("abc123@google.com");
  });
});

describe("tautan", () => {
  it("safeHttpUrl hanya menerima http(s) tanpa kredensial", () => {
    expect(safeHttpUrl("https://meet.google.com/a-b-c")).toBe(
      "https://meet.google.com/a-b-c",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>")).toBeNull();
    expect(safeHttpUrl("https://user:pw@x.id/")).toBeNull();
    expect(safeHttpUrl("bukan url")).toBeNull();
    expect(safeHttpUrl("https://x.id/" + "a".repeat(600))).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("findMeetUrl: kolom eksplisit lebih dulu, teks hanya bila penyedianya dikenal", () => {
    expect(
      findMeetUrl({
        conference: "https://meet.google.com/a-b-c",
        description: "https://zoom.us/j/1",
      }),
    ).toBe("https://meet.google.com/a-b-c");
    expect(findMeetUrl({ location: "https://zoom.us/j/123" })).toBe(
      "https://zoom.us/j/123",
    );
    expect(
      findMeetUrl({
        description: "Gabung di https://us02web.zoom.us/j/999. Terima kasih",
      }),
    ).toBe("https://us02web.zoom.us/j/999");
    expect(
      findMeetUrl({ description: "Lihat https://situs-acak.example/x" }),
    ).toBeNull();
    expect(findMeetUrl({ location: "javascript:alert(1)" })).toBeNull();
    expect(findMeetUrl({})).toBeNull();
  });
});

describe("plainText", () => {
  it("membuang tag, mengurai entitas umum, dan memotong sesuai batas", () => {
    expect(plainText("<p>Halo<br>dunia</p> &amp; &lt;b&gt;", 100)).toBe(
      "Halo\ndunia\n & <b>",
    );
    expect(plainText("a\u0000b\u0007c", 100)).toBe("abc");
    expect(plainText("x".repeat(50), 10)).toHaveLength(10);
    expect(plainText(undefined, 10)).toBe("");
  });
});

describe("formatWhen", () => {
  it("memakai zona waktu yang diminta dan bahasa Indonesia", () => {
    const text = formatWhen(
      new Date("2026-11-20T02:00:00Z"),
      new Date("2026-11-20T03:00:00Z"),
      "Asia/Jakarta",
      false,
    );
    expect(text).toContain("Jumat");
    expect(text).toContain("20 November 2026");
    expect(text).toContain("09.00");
    expect(text).toContain("10.00");
    expect(text).toContain("(Asia/Jakarta)");
  });

  it("acara lintas hari dan sehari penuh", () => {
    expect(
      formatWhen(
        new Date("2026-11-20T15:00:00Z"),
        new Date("2026-11-20T18:00:00Z"),
        "Asia/Jakarta",
        false,
      ),
    ).toMatch(/20 November 2026, 22\.00 – .*21 November 2026, 01\.00/);
    expect(
      formatWhen(
        new Date("2026-11-20T00:00:00Z"),
        new Date("2026-11-22T00:00:00Z"),
        "Asia/Jakarta",
        true,
      ),
    ).toBe("Jumat, 20 November 2026 – Minggu, 22 November 2026 (sehari penuh)");
  });

  it("zona waktu tidak dikenal jatuh ke UTC tanpa error", () => {
    expect(() =>
      formatWhen(new Date(), new Date(), "Bukan/Zona", false),
    ).not.toThrow();
  });
});
