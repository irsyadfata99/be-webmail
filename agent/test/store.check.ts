import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AccountStore, StoreError } from "../src/store.ts";

let dir: string;
let store: AccountStore;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-store-"));
  store = new AccountStore(dir);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const accountsFile = () => join(dir, "postfix-accounts.cf");
const read = (name: string) => readFile(join(dir, name), "utf8");

/** Menghitung ulang hash dengan salt yang sama lewat openssl dan membandingkannya. */
function passwordMatches(line: string, password: string): boolean {
  const hash = line.split("|{SHA512-CRYPT}")[1] ?? "";
  const salt = hash.split("$")[2] ?? "";
  const again = execFileSync(
    "openssl",
    ["passwd", "-6", "-salt", salt, "-stdin"],
    {
      input: `${password}\n`,
    },
  )
    .toString()
    .trim();
  return again === hash;
}

const lineOf = async (email: string) =>
  (await read("postfix-accounts.cf"))
    .split("\n")
    .find((l) => l.startsWith(`${email}|`)) ?? "";

test("create menulis baris SHA512-CRYPT yang cocok dengan password", async () => {
  await store.create("budi@example.com", "Sandi Pertama 123!");
  const line = await lineOf("budi@example.com");
  assert.match(
    line,
    /^budi@example\.com\|\{SHA512-CRYPT\}\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/,
  );
  assert.equal(passwordMatches(line, "Sandi Pertama 123!"), true);
  assert.equal(passwordMatches(line, "sandi salah 12345"), false);
  assert.ok((await read("postfix-accounts.cf")).endsWith("\n"));
});

test("password dengan spasi, simbol, dan unicode tersimpan apa adanya", async () => {
  const passwords = [
    "  spasi di tepi  ",
    "p@ss:word/dengan|simbol$&'\"`",
    "kata sandi ✓ ünïcode 日本語",
  ];
  for (const [i, password] of passwords.entries()) {
    const email = `unik${i}@example.com`;
    await store.create(email, password);
    assert.equal(passwordMatches(await lineOf(email), password), true, email);
  }
});

test("create menolak akun ganda dengan 409", async () => {
  await assert.rejects(
    store.create("budi@example.com", "Sandi Kedua 12345"),
    (e: unknown) =>
      e instanceof StoreError &&
      e.status === 409 &&
      e.code === "ACCOUNT_EXISTS",
  );
});

test("setPassword mengganti hash akun itu saja", async () => {
  const before = await lineOf("unik0@example.com");
  await store.setPassword("budi@example.com", "Sandi Baru 456789!");
  const line = await lineOf("budi@example.com");
  assert.equal(passwordMatches(line, "Sandi Baru 456789!"), true);
  assert.equal(passwordMatches(line, "Sandi Pertama 123!"), false);
  assert.equal(await lineOf("unik0@example.com"), before);
});

test("setPassword, setQuota, dan remove pada akun yang tidak ada memberi 404", async () => {
  const notFound = (e: unknown) => e instanceof StoreError && e.status === 404;
  await assert.rejects(
    store.setPassword("hantu@example.com", "Sandi Apa Saja 1"),
    notFound,
  );
  await assert.rejects(store.setQuota("hantu@example.com", "1G"), notFound);
  await assert.rejects(store.remove("hantu@example.com"), notFound);
});

test("kuota: atur, tampil di list, ubah, dan hapus", async () => {
  await store.setQuota("budi@example.com", "2G");
  assert.equal(
    (await store.list()).find((a) => a.email === "budi@example.com")?.quota,
    "2G",
  );
  await store.setQuota("budi@example.com", "500M");
  assert.equal(
    (await read("dovecot-quotas.cf")).match(/budi@example\.com:/g)?.length,
    1,
  );
  assert.equal(
    (await store.list()).find((a) => a.email === "budi@example.com")?.quota,
    "500M",
  );
  await store.setQuota("budi@example.com", null);
  assert.equal(
    (await store.list()).find((a) => a.email === "budi@example.com")?.quota,
    null,
  );
});

test("setActive(false) mengunci login, setActive(true) mengembalikan hash asli", async () => {
  const email = "kunci@example.com";
  await store.create(email, "Sandi Asli Kunci 1!");
  const original = await lineOf(email);

  await store.setActive(email, false);
  const locked = await lineOf(email);
  assert.notEqual(locked, original);
  assert.equal(passwordMatches(locked, "Sandi Asli Kunci 1!"), false);
  assert.match(locked, /^kunci@example\.com\|\{SHA512-CRYPT\}\$6\$/);
  assert.equal(
    (await store.list()).find((a) => a.email === email)?.disabled,
    true,
  );

  // Idempoten: mengunci dua kali tidak menimpa hash asli yang tersimpan.
  await store.setActive(email, false);
  await store.setActive(email, true);
  assert.equal(await lineOf(email), original);
  assert.equal(
    passwordMatches(await lineOf(email), "Sandi Asli Kunci 1!"),
    true,
  );
  assert.equal(
    (await store.list()).find((a) => a.email === email)?.disabled,
    false,
  );
  assert.equal((await read("webmail-disabled.cf")).includes(email), false);
});

test("setActive(false) melanjutkan penguncian yang terhenti di tengah, tanpa menimpa hash asli", async () => {
  const email = "setengah@example.com";
  await store.create(email, "Sandi Setengah Jalan 1!");
  const original = await lineOf(email);

  // Meniru kegagalan: hash asli sudah tersimpan, tetapi baris akun belum dikunci.
  const saved = await readFile(join(dir, "webmail-disabled.cf"), "utf8").catch(
    () => "",
  );
  await writeFile(
    join(dir, "webmail-disabled.cf"),
    `${saved}${email}|${original.split("|")[1]}\n`,
  );
  assert.equal(await lineOf(email), original);

  await store.setActive(email, false);
  const locked = await lineOf(email);
  assert.notEqual(locked, original);
  assert.equal(passwordMatches(locked, "Sandi Setengah Jalan 1!"), false);
  const entries = (await read("webmail-disabled.cf"))
    .split("\n")
    .filter((l) => l.startsWith(`${email}|`));
  assert.equal(entries.length, 1);

  await store.setActive(email, true);
  assert.equal(await lineOf(email), original);
  assert.equal(
    passwordMatches(await lineOf(email), "Sandi Setengah Jalan 1!"),
    true,
  );
});

test("password direset saat akun nonaktif: tetap terkunci, berlaku setelah diaktifkan", async () => {
  const email = "reset@example.com";
  await store.create(email, "Sandi Lama Reset 1!");
  await store.setActive(email, false);
  const locked = await lineOf(email);
  await store.setPassword(email, "Sandi Baru Reset 2!");
  assert.equal(await lineOf(email), locked);
  await store.setActive(email, true);
  assert.equal(
    passwordMatches(await lineOf(email), "Sandi Baru Reset 2!"),
    true,
  );
  assert.equal(
    passwordMatches(await lineOf(email), "Sandi Lama Reset 1!"),
    false,
  );
});

test("setActive pada akun tak ada memberi 404; remove membersihkan catatan nonaktif", async () => {
  await assert.rejects(
    store.setActive("hantu@example.com", false),
    (e: unknown) => e instanceof StoreError && e.status === 404,
  );
  const email = "hapus@example.com";
  await store.create(email, "Sandi Hapus Saya 1!");
  await store.setActive(email, false);
  await store.remove(email);
  assert.equal((await read("webmail-disabled.cf")).includes(email), false);
  await store.create(email, "Sandi Hapus Saya 1!");
  assert.equal(
    (await store.list()).find((a) => a.email === email)?.disabled,
    false,
  );
});

test("list tidak pernah memuat hash dan terurut", async () => {
  const accounts = await store.list();
  assert.ok(accounts.length >= 4);
  assert.ok(JSON.stringify(accounts).indexOf("$6$") === -1);
  const emails = accounts.map((a) => a.email);
  assert.deepEqual(
    emails,
    [...emails].sort((a, b) => a.localeCompare(b)),
  );
});

test("remove menghapus akun beserta kuotanya dan membiarkan akun lain", async () => {
  await store.setQuota("unik1@example.com", "1G");
  await store.remove("unik1@example.com");
  assert.equal(
    (await read("postfix-accounts.cf")).includes("unik1@example.com"),
    false,
  );
  assert.equal(
    (await read("dovecot-quotas.cf")).includes("unik1@example.com"),
    false,
  );
  assert.ok((await read("postfix-accounts.cf")).includes("unik0@example.com"));
});

test("komentar dan baris asing dipertahankan, CRLF dirapikan", async () => {
  const other = await mkdtemp(join(tmpdir(), "agent-keep-"));
  try {
    await writeFile(
      join(other, "postfix-accounts.cf"),
      "# akun lama\r\nlama@example.com|{SHA512-CRYPT}$6$abc$xyz\r\n\r\n# catatan\r\n",
    );
    await writeFile(
      join(other, "dovecot-quotas.cf"),
      "# kuota\nlama@example.com:3G\n",
    );
    const s = new AccountStore(other);
    await s.create("baru@example.com", "Sandi Baru Banget 1");
    await s.setQuota("baru@example.com", "1G");
    const accounts = await readFile(join(other, "postfix-accounts.cf"), "utf8");
    assert.ok(
      accounts.startsWith(
        "# akun lama\nlama@example.com|{SHA512-CRYPT}$6$abc$xyz\n",
      ),
    );
    assert.ok(accounts.includes("# catatan"));
    assert.ok(accounts.includes("baru@example.com|{SHA512-CRYPT}$6$"));
    assert.equal(accounts.includes("\r"), false);
    const quotas = await readFile(join(other, "dovecot-quotas.cf"), "utf8");
    assert.ok(quotas.startsWith("# kuota\nlama@example.com:3G\n"));
    assert.ok(quotas.includes("baru@example.com:1G"));
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});

test("15 pembuatan paralel semuanya tersimpan tanpa saling menimpa", async () => {
  const other = await mkdtemp(join(tmpdir(), "agent-par-"));
  try {
    const s = new AccountStore(other);
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        s.create(`par${i}@example.com`, `Sandi Paralel ${i} aman`),
      ),
    );
    assert.equal((await s.list()).length, 15);
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});

test("salinan .bak dibuat dan tidak ada berkas .tmp tersisa", async () => {
  const files = await readdir(dir);
  assert.ok(files.includes("postfix-accounts.cf.bak"));
  assert.deepEqual(
    files.filter((f) => f.endsWith(".tmp")),
    [],
  );
  assert.ok((await read("postfix-accounts.cf.bak")).length > 0);
  assert.equal(accountsFile().endsWith("postfix-accounts.cf"), true);
});
