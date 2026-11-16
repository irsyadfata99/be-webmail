import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAgentApp } from "../src/app.ts";
import { AccountStore } from "../src/store.ts";

const TOKEN = "ab".repeat(32);
let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-http-"));
  server = createAgentApp(
    {
      token: TOKEN,
      domain: "example.com",
      configDir: dir,
      port: 0,
      host: "127.0.0.1",
    },
    new AccountStore(dir),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "Content-Type": "application/json" };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = json,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, any>,
  };
}

test("/health terbuka tanpa token, rute lain menolak tanpa atau dengan token salah", async () => {
  assert.equal((await call("GET", "/health", undefined, {})).status, 200);
  assert.equal((await call("GET", "/accounts", undefined, {})).status, 401);
  assert.equal(
    (
      await call("GET", "/accounts", undefined, {
        Authorization: "Bearer salah",
      })
    ).status,
    401,
  );
  assert.equal(
    (await call("GET", "/accounts", undefined, { Authorization: TOKEN }))
      .status,
    401,
  );
  const wrong = { Authorization: `Bearer ${"cd".repeat(32)}` };
  assert.equal((await call("GET", "/accounts", undefined, wrong)).status, 401);
});

test("alur akun lengkap lewat HTTP", async () => {
  const created = await call("POST", "/accounts", {
    email: "Siti@Example.com",
    password: "Sandi Siti 123456",
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { email: "siti@example.com" });

  const dup = await call("POST", "/accounts", {
    email: "siti@example.com",
    password: "Sandi Siti 123456",
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "ACCOUNT_EXISTS");

  const list = await call("GET", "/accounts");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.accounts, [
    { email: "siti@example.com", quota: null, disabled: false },
  ]);
  assert.equal(JSON.stringify(list.body).includes("$6$"), false);

  const off = await call("PUT", "/accounts/siti%40example.com/active", {
    active: false,
  });
  assert.deepEqual(off.body, { email: "siti@example.com", active: false });
  assert.equal((await call("GET", "/accounts")).body.accounts[0].disabled, true);
  assert.equal(
    (await call("PUT", "/accounts/siti%40example.com/active", { active: "ya" }))
      .status,
    400,
  );
  assert.equal(
    (await call("PUT", "/accounts/hantu%40example.com/active", { active: false }))
      .status,
    404,
  );
  await call("PUT", "/accounts/siti%40example.com/active", { active: true });
  assert.equal(
    (await call("GET", "/accounts")).body.accounts[0].disabled,
    false,
  );

  assert.equal(
    (
      await call("PUT", "/accounts/siti%40example.com/password", {
        password: "Sandi Baru Siti 789",
      })
    ).status,
    200,
  );
  const q = await call("PUT", "/accounts/siti%40example.com/quota", {
    quota: "2g",
  });
  assert.deepEqual(q.body, { email: "siti@example.com", quota: "2G" });
  assert.equal((await call("GET", "/accounts")).body.accounts[0].quota, "2G");
  assert.equal(
    (await call("PUT", "/accounts/siti%40example.com/quota", { quota: null }))
      .body.quota,
    null,
  );

  assert.equal(
    (await call("DELETE", "/accounts/siti%40example.com")).status,
    200,
  );
  assert.equal(
    (await call("DELETE", "/accounts/siti%40example.com")).status,
    404,
  );
  assert.deepEqual((await call("GET", "/accounts")).body.accounts, []);
});

test("input tidak valid ditolak dengan 400 dan pesan yang jelas", async () => {
  const cases: Array<[string, string, unknown, string]> = [
    [
      "POST",
      "/accounts",
      { email: "x@lain.com", password: "Sandi Cukup Panjang" },
      "INVALID_EMAIL",
    ],
    [
      "POST",
      "/accounts",
      { email: "x@example.com", password: "pendek" },
      "INVALID_PASSWORD",
    ],
    ["POST", "/accounts", { password: "Sandi Cukup Panjang" }, "INVALID_EMAIL"],
    [
      "PUT",
      "/accounts/siti%40example.com/quota",
      { quota: "99X" },
      "INVALID_QUOTA",
    ],
    [
      "PUT",
      "/accounts/%E0%A4%A/password",
      { password: "Sandi Cukup Panjang" },
      "INVALID_EMAIL",
    ],
    [
      "PUT",
      "/accounts/..%2F..%2Fetc%2Fpasswd/password",
      { password: "Sandi Cukup Panjang" },
      "INVALID_EMAIL",
    ],
  ];
  for (const [method, path, body, code] of cases) {
    const res = await call(method, path, body);
    assert.equal(res.status, 400, `${method} ${path}`);
    assert.equal(res.body.error.code, code, `${method} ${path}`);
  }
});

test("body terlalu besar 413, bukan JSON 415, JSON rusak 400", async () => {
  const big = await call("POST", "/accounts", {
    email: "a@example.com",
    password: "x".repeat(20_000),
  });
  assert.equal(big.status, 413);
  assert.equal(
    (
      await call(
        "POST",
        "/accounts",
        { x: 1 },
        { ...auth, "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  const broken = await fetch(`${base}/accounts`, {
    method: "POST",
    headers: json,
    body: "{rusak",
  });
  assert.equal(broken.status, 400);
});

test("rute tidak dikenal 404 dan metode salah 405", async () => {
  assert.equal((await call("GET", "/tidak-ada")).status, 404);
  assert.equal((await call("DELETE", "/accounts")).status, 405);
  assert.equal(
    (await call("GET", "/accounts/siti%40example.com/password")).status,
    405,
  );
  assert.equal(
    (await call("POST", "/accounts/siti%40example.com", {})).status,
    405,
  );
});
