import { describe, expect, it } from "vitest";
import {
  eventUidParams,
  invitationBody,
  invitationUpdateBody,
  resolveTimes,
  rsvpBody,
} from "../src/modules/calendar/calendar.schema.js";

const valid = {
  title: "Rapat mingguan",
  start: "2026-11-20T09:00:00+07:00",
  end: "2026-11-20T10:00:00+07:00",
  attendees: ["Budi@X.id"],
};

describe("invitationBody", () => {
  it("menerima undangan minimal dan mengisi nilai bawaan", () => {
    const r = invitationBody.parse(valid);
    expect(r.allDay).toBe(false);
    expect(r.timezone).toBe("Asia/Jakarta");
    expect(r.attendees).toEqual(["budi@x.id"]);
    expect(r.meetUrl).toBeUndefined();
  });

  it("menerima tautan rapat manual berupa http(s)", () => {
    expect(
      invitationBody.safeParse({
        ...valid,
        meetUrl: "https://meet.google.com/abc-defg-hij",
      }).success,
    ).toBe(true);
    expect(
      invitationBody.safeParse({ ...valid, meetUrl: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...valid, meetUrl: "bukan-url" }).success,
    ).toBe(false);
  });

  it("menolak judul kosong atau berisi baris baru, dan peserta kosong atau tidak valid", () => {
    expect(invitationBody.safeParse({ ...valid, title: "  " }).success).toBe(
      false,
    );
    expect(
      invitationBody.safeParse({ ...valid, title: "a\r\nBcc: x@y.id" }).success,
    ).toBe(false);
    expect(invitationBody.safeParse({ ...valid, attendees: [] }).success).toBe(
      false,
    );
    expect(
      invitationBody.safeParse({ ...valid, attendees: ["bukan-email"] })
        .success,
    ).toBe(false);
  });

  it("waktu harus ISO dengan zona, dan akhir sesudah awal", () => {
    expect(
      invitationBody.safeParse({ ...valid, start: "2026-11-20T09:00:00" })
        .success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...valid, start: "20 November 2026" }).success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...valid, end: valid.start }).success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...valid, end: "2026-11-20T08:00:00+07:00" })
        .success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...valid, end: "2026-12-30T10:00:00+07:00" })
        .success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({
        ...valid,
        start: "2026-11-20T09:00Z",
        end: "2026-11-20T10:00Z",
      }).success,
    ).toBe(true);
  });

  it("acara sehari penuh memakai tanggal saja dan boleh satu hari", () => {
    const day = {
      ...valid,
      allDay: true,
      start: "2026-11-20",
      end: "2026-11-20",
    };
    expect(invitationBody.safeParse(day).success).toBe(true);
    expect(
      invitationBody.safeParse({ ...day, end: "2026-11-22" }).success,
    ).toBe(true);
    expect(
      invitationBody.safeParse({ ...day, end: "2026-11-19" }).success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({
        ...day,
        start: "2026-02-31",
        end: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(
      invitationBody.safeParse({ ...day, start: "2026-11-20T09:00:00Z" })
        .success,
    ).toBe(false);
  });

  it("zona waktu harus dikenal", () => {
    expect(
      invitationBody.safeParse({ ...valid, timezone: "Asia/Makassar" }).success,
    ).toBe(true);
    expect(
      invitationBody.safeParse({ ...valid, timezone: "Bukan/Zona" }).success,
    ).toBe(false);
  });
});

describe("invitationUpdateBody / eventUidParams", () => {
  it("ubah dan batalkan mewajibkan sequence", () => {
    expect(invitationUpdateBody.safeParse(valid).success).toBe(false);
    expect(
      invitationUpdateBody.safeParse({ ...valid, sequence: 0 }).success,
    ).toBe(true);
    expect(
      invitationUpdateBody.safeParse({ ...valid, sequence: -1 }).success,
    ).toBe(false);
    expect(
      invitationUpdateBody.safeParse({ ...valid, sequence: 1.5 }).success,
    ).toBe(false);
  });

  it("eventUid hanya berisi karakter aman", () => {
    expect(
      eventUidParams.safeParse({ eventUid: "3f2a-91c0@motioneggstudios.com" })
        .success,
    ).toBe(true);
    expect(eventUidParams.safeParse({ eventUid: "a/b" }).success).toBe(false);
    expect(eventUidParams.safeParse({ eventUid: "a b" }).success).toBe(false);
    expect(eventUidParams.safeParse({ eventUid: "x" }).success).toBe(false);
  });
});

describe("resolveTimes", () => {
  it("menghasilkan Date UTC", () => {
    const r = resolveTimes({
      allDay: false,
      start: valid.start,
      end: valid.end,
    });
    expect(r.ok && r.times.start.toISOString()).toBe(
      "2026-11-20T02:00:00.000Z",
    );
    const d = resolveTimes({
      allDay: true,
      start: "2026-11-20",
      end: "2026-11-21",
    });
    expect(d.ok && d.times.end.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });
});

describe("rsvpBody", () => {
  it("menerima tiga jawaban dan komentar opsional", () => {
    for (const response of ["accepted", "declined", "tentative"]) {
      expect(rsvpBody.safeParse({ folder: "INBOX", response }).success).toBe(
        true,
      );
    }
    expect(
      rsvpBody.safeParse({ folder: "INBOX", response: "maybe" }).success,
    ).toBe(false);
    expect(rsvpBody.safeParse({ response: "accepted" }).success).toBe(false);
    expect(
      rsvpBody.safeParse({
        folder: "INBOX",
        response: "accepted",
        comment: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});
