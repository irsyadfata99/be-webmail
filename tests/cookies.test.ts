import { describe, expect, it } from "vitest";
import { parseCookies } from "../src/lib/cookies.js";

describe("parseCookies", () => {
  it("membaca beberapa cookie", () => {
    expect(parseCookies("a=1; b=dua; c=%20x")).toEqual({
      a: "1",
      b: "dua",
      c: " x",
    });
  });

  it("nilai pertama yang dipakai bila nama kembar", () => {
    expect(parseCookies("a=1; a=2").a).toBe("1");
  });

  it("header kosong atau rusak tidak menimbulkan error", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("rusak; =x; y=%E0%A4%A")).toMatchObject({
      y: "%E0%A4%A",
    });
  });
});
