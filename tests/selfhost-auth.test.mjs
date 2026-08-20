// Pure-logic tests for the self-hosted form-login auth module and the
// configure-selfhost-auth script. Never touches the real database, Vault, or
// any production secret.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookieHeader,
  constantTimeEqual,
  generateSessionSecret,
  hashPassword,
  parseCookieHeader,
  safeReturnTo,
  sessionCookieHeader,
  sessionTokenFromHeaders,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from "../lib/selfhost-auth.mjs";
import {
  stripTrailingCarriageReturn,
  writeAuthEnv,
} from "../scripts/configure-selfhost-auth.mjs";

const FAST_ITERATIONS = 1000;

// ========== password hashing ==========

test("hashPassword produces a versioned PBKDF2-SHA256 hash", async () => {
  const hash = await hashPassword("s3cret", FAST_ITERATIONS);
  const parts = hash.split("$");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "pbkdf2-sha256");
  assert.equal(Number(parts[1]), FAST_ITERATIONS);
  assert.ok(parts[2].length > 0);
  assert.ok(parts[3].length > 0);
});

test("verifyPassword accepts the correct password and rejects a wrong one", async () => {
  const hash = await hashPassword("correct horse", FAST_ITERATIONS);
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong horse", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("verifyPassword rejects malformed or unknown-version hashes", async () => {
  assert.equal(await verifyPassword("pw", "not-a-hash"), false);
  assert.equal(await verifyPassword("pw", "pbkdf2-sha256$abc"), false);
  assert.equal(await verifyPassword("pw", "md5$1000$c2FsdA==$YQ=="), false);
  assert.equal(await verifyPassword("pw", null), false);
  assert.equal(await verifyPassword("pw", undefined), false);
});

test("hashPassword salts each call so equal passwords hash differently", async () => {
  const a = await hashPassword("same", FAST_ITERATIONS);
  const b = await hashPassword("same", FAST_ITERATIONS);
  assert.notEqual(a, b);
});

// ========== session tokens ==========

test("session token round-trips username and expiry", async () => {
  const secret = generateSessionSecret();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = await signSessionToken("selfhost@local", secret, exp);
  const session = await verifySessionToken(token, secret);
  assert.deepEqual(session, { username: "selfhost@local", exp });
});

test("session token is rejected when the signature is tampered", async () => {
  const secret = generateSessionSecret();
  const token = await signSessionToken("selfhost@local", secret, Math.floor(Date.now() / 1000) + 3600);
  const dot = token.lastIndexOf(".");
  const tamperedPayload = token.slice(0, dot - 1) + (token[dot - 1] === "A" ? "B" : "A") + token.slice(dot);
  const tamperedSignature = token.slice(0, dot + 1) + (token[dot + 1] === "A" ? "B" : "A") + token.slice(dot + 2);
  assert.equal(await verifySessionToken(tamperedPayload, secret), null);
  assert.equal(await verifySessionToken(tamperedSignature, secret), null);
  assert.equal(await verifySessionToken("garbage", secret), null);
});

test("session token is rejected after expiry", async () => {
  const secret = generateSessionSecret();
  const token = await signSessionToken("selfhost@local", secret, Math.floor(Date.now() / 1000) - 10);
  assert.equal(await verifySessionToken(token, secret), null);
});

test("session token is rejected with a different secret", async () => {
  const token = await signSessionToken("selfhost@local", generateSessionSecret(), Math.floor(Date.now() / 1000) + 3600);
  assert.equal(await verifySessionToken(token, generateSessionSecret()), null);
});

// ========== redirect safety ==========

test("safeReturnTo keeps same-origin relative paths", () => {
  assert.equal(safeReturnTo("/"), "/");
  assert.equal(safeReturnTo("/review"), "/review");
  assert.equal(safeReturnTo("/review?q=1&f=2"), "/review?q=1&f=2");
  assert.equal(safeReturnTo("/a/b#top"), "/a/b#top");
});

test("safeReturnTo rejects external or protocol-relative targets", () => {
  assert.equal(safeReturnTo("https://evil.example/"), null);
  assert.equal(safeReturnTo("//evil.example/"), null);
  assert.equal(safeReturnTo("/\\evil.example/"), null);
  assert.equal(safeReturnTo("javascript:alert(1)"), null);
  assert.equal(safeReturnTo(""), null);
  assert.equal(safeReturnTo(null), null);
  assert.equal(safeReturnTo(undefined), null);
});

test("safeReturnTo rejects auth-loop targets", () => {
  assert.equal(safeReturnTo("/login"), null);
  assert.equal(safeReturnTo("/logout"), null);
  assert.equal(safeReturnTo("/api/selfhost-auth/login"), null);
  assert.equal(safeReturnTo("/api/selfhost-auth/check"), null);
});

// ========== session cookie ==========

test("session cookie uses __Host- prefix with the required attributes", () => {
  const header = sessionCookieHeader("token-value");
  assert.ok(header.startsWith(`${SESSION_COOKIE_NAME}=token-value;`));
  for (const attr of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
    assert.ok(header.includes(attr), `${attr} missing from ${header}`);
  }
  assert.ok(header.includes("Max-Age=2592000"));
});

test("clearSessionCookieHeader expires the cookie immediately", () => {
  const header = clearSessionCookieHeader();
  assert.ok(header.startsWith(`${SESSION_COOKIE_NAME}=;`));
  assert.ok(header.includes("Max-Age=0"));
});

test("parseCookieHeader extracts the session token from a Cookie header", () => {
  const cookie = "other=1; __Host-kaoyan_session=abc123; lang=zh-CN";
  assert.equal(parseCookieHeader(cookie)[SESSION_COOKIE_NAME], "abc123");
  assert.equal(parseCookieHeader(undefined)[SESSION_COOKIE_NAME], undefined);
});

test("sessionTokenFromHeaders reads the cookie from Headers-like objects", () => {
  const headers = new Headers({ cookie: `__Host-kaoyan_session=tok; a=b` });
  assert.equal(sessionTokenFromHeaders(headers), "tok");
  assert.equal(sessionTokenFromHeaders({ cookie: `__Host-kaoyan_session=tok` }), "tok");
  assert.equal(sessionTokenFromHeaders(new Headers()), null);
});

// ========== CRLF pipe normalization (Windows PowerShell) ==========

test("stripTrailingCarriageReturn removes only a single trailing CR", () => {
  assert.equal(stripTrailingCarriageReturn("password\r"), "password");
  assert.equal(stripTrailingCarriageReturn("password"), "password");
  assert.equal(stripTrailingCarriageReturn("  pass  \r"), "  pass  ");
  assert.equal(stripTrailingCarriageReturn("pa\rss\r"), "pa\rss");
  assert.equal(stripTrailingCarriageReturn("\r"), "");
  assert.equal(stripTrailingCarriageReturn(""), "");
  assert.equal(stripTrailingCarriageReturn("pass\r\r"), "pass\r");
});
// ========== constant-time compare ==========

test("constantTimeEqual compares bytes without leaking length differences", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
});

// ========== configure-selfhost-auth script ==========

test("configure-selfhost-auth writes auth.env without the plaintext password", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-auth-test-"));
  try {
    const file = path.join(tmpDir, "data", "auth.env");
    const written = await writeAuthEnv(file, "reviewer", "hunter2-secret");
    assert.equal(written, file);

    const content = fs.readFileSync(file, "utf8");
    assert.match(content, /^SELFHOST_FORM_AUTH=1$/m);
    assert.match(content, /^SELFHOST_AUTH_USERNAME=reviewer$/m);
    assert.match(content, /^SELFHOST_AUTH_PASSWORD_HASH=pbkdf2-sha256\$/m);
    assert.match(content, /^SELFHOST_SESSION_SECRET=.+$/m);
    assert.ok(!content.includes("hunter2-secret"), "plaintext password leaked into auth.env");

    const hash = content.match(/^SELFHOST_AUTH_PASSWORD_HASH=(.+)$/m)?.[1] ?? "";
    assert.equal(await verifyPassword("hunter2-secret", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);

    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});