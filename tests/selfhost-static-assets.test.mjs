import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStaticCacheKeys } from "../selfhost/static-assets.mjs";

test("Windows selfhost normalizes vinext cache keys to URL slashes", () => {
  const cache = { entries: new Map([
    ["/assets\\framework.js", { type: "js" }],
    ["/favicon.svg", { type: "svg" }],
  ]) };

  const normalized = normalizeStaticCacheKeys(cache, "win32");
  assert.equal(normalized.entries.has("/assets/framework.js"), true);
  assert.equal(normalized.entries.has("/assets\\framework.js"), false);
  assert.deepEqual([...normalized.entries.keys()], ["/assets/framework.js", "/favicon.svg"]);
});

test("non-Windows selfhost leaves URL cache keys untouched", () => {
  const entries = new Map([["/assets/framework.js", { type: "js" }]]);
  const cache = { entries };
  assert.equal(normalizeStaticCacheKeys(cache, "linux").entries, entries);
});
