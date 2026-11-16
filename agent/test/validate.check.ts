import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import {
  normalizeEmail,
  parseQuota,
  passwordProblem,
} from "../src/validate.ts";

const DOMAIN = "example.com";

test("normalizeEmail menerima email valid dan menyeragamkan huruf kecil", () => {
  assert.equal(
    normalizeEmail("Budi.Santoso@Example.com ", DOMAIN),
    "budi.santoso@example.com",
  );
  assert.equal(normalizeEmail("a@example.com", DOMAIN), "a@example.com");
  assert.equal(
    normalizeEmail("tim-1_x@example.com", DOMAIN),
    "tim-1_x@example.com",
  );
});

test("normalizeEmail menolak domain lain, bentuk aneh, dan non-teks", () => {
  for (const bad of [
    "budi@lain.com",
    "budi@sub.example.com",
    "@example.com",
    "budi@",
    "budi",
    "a@b@example.com",
    "bu di@example.com",
    "budi+tag@example.com",
    ".budi@example.com",
    "budi.@example.com",
    "bu..di@example.com",
    "budi\n@example.com",
    "budi|x@example.com",
    "budi:x@example.com",
    `${"a".repeat(65)}@example.com`,
  ]) {
    assert.equal(normalizeEmail(bad, DOMAIN), null, bad);
  }
  assert.equal(normalizeEmail(123, DOMAIN), null);
  assert.equal(normalizeEmail(undefined, DOMAIN), null);
});

test("passwordProblem memeriksa panjang dan karakter terlarang", () => {
  assert.equal(passwordProblem("p@ss: dengan spasi ✓ ok"), null);
  assert.equal(passwordProblem("a".repeat(12)), null);
  assert.match(passwordProblem("pendek") ?? "", /minimal 12/);
  assert.match(passwordProblem("a".repeat(129)) ?? "", /maksimal 128/);
  assert.match(passwordProblem(`${"a".repeat(12)}\nx`) ?? "", /baris baru/);
  assert.match(passwordProblem(`${"a".repeat(12)}\0`) ?? "", /baris baru/);
  assert.match(passwordProblem(42) ?? "", /teks/);
});

test("parseQuota menerima 500M dan 2G, null untuk hapus, dan menolak sisanya", () => {
  assert.deepEqual(parseQuota("2g"), { ok: true, value: "2G" });
  assert.deepEqual(parseQuota(" 500M "), { ok: true, value: "500M" });
  assert.deepEqual(parseQuota(null), { ok: true, value: null });
  for (const bad of [
    "0G",
    "2",
    "2T",
    "G",
    "-1G",
    "1.5G",
    "2GB",
    "",
    5,
    undefined,
  ]) {
    assert.deepEqual(parseQuota(bad), { ok: false }, String(bad));
  }
});

test("loadConfig menolak token dan domain tidak valid tanpa menampilkan nilainya", () => {
  assert.throws(
    () =>
      loadConfig({
        AGENT_TOKEN: "rahasia-pendek",
        MAIL_DOMAIN: "bukan domain",
      }),
    (err: Error) =>
      /AGENT_TOKEN/.test(err.message) &&
      /MAIL_DOMAIN/.test(err.message) &&
      !err.message.includes("rahasia-pendek"),
  );
  const ok = loadConfig({
    AGENT_TOKEN: "a".repeat(64),
    MAIL_DOMAIN: "Example.COM",
  });
  assert.equal(ok.domain, "example.com");
  assert.equal(ok.port, 4000);
  assert.equal(ok.configDir, "/config");
});
