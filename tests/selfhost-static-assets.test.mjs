import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_CACHE_CONTROL,
  normalizeStaticCacheKeys,
} from "../selfhost/static-assets.mjs";

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

test("history JSON is always served with revalidation-required cache policy", () => {
  const cache = {
    entries: new Map([["/data/history.json", {
      original: { headers: { "Cache-Control": "public, max-age=3600" } },
      br: { headers: { "Cache-Control": "public, max-age=3600" } },
      notModifiedHeaders: { "Cache-Control": "public, max-age=3600" },
    }]]),
  };
  normalizeStaticCacheKeys(cache, "linux");
  const entry = cache.entries.get("/data/history.json");
  assert.equal(entry.original.headers["Cache-Control"], HISTORY_CACHE_CONTROL);
  assert.equal(entry.br.headers["Cache-Control"], HISTORY_CACHE_CONTROL);
  assert.equal(entry.notModifiedHeaders["Cache-Control"], HISTORY_CACHE_CONTROL);
});
