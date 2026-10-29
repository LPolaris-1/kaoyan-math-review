import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_CACHE_CONTROL,
  HISTORY_DAYS_PREFIX,
  HISTORY_INDEX_PATH,
  isHistoryDataPath,
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

test("history JSON, index and day shards keep revalidation while preserving ETag and Vary", () => {
  const cache = {
    entries: new Map([
      ["/data/history.json", historyEntry()],
      [HISTORY_INDEX_PATH, historyEntry()],
      [`${HISTORY_DAYS_PREFIX}2026-10-22.json`, historyEntry()],
      ["/data/other.json", historyEntry()],
    ]),
  };
  normalizeStaticCacheKeys(cache, "linux");
  for (const path of ["/data/history.json", HISTORY_INDEX_PATH, `${HISTORY_DAYS_PREFIX}2026-10-22.json`]) {
    const entry = cache.entries.get(path);
    assert.equal(entry.original.headers["Cache-Control"], HISTORY_CACHE_CONTROL);
    assert.equal(entry.br.headers["Cache-Control"], HISTORY_CACHE_CONTROL);
    assert.equal(entry.gz.headers["Cache-Control"], HISTORY_CACHE_CONTROL);
    assert.equal(entry.notModifiedHeaders["Cache-Control"], HISTORY_CACHE_CONTROL);
    assert.equal(entry.original.headers.ETag, 'W/"history-etag"');
    assert.equal(entry.notModifiedHeaders.ETag, 'W/"history-etag"');
    assert.equal(entry.br.headers.Vary, "Accept-Encoding");
    assert.equal(entry.notModifiedHeaders.Vary, "Accept-Encoding");
  }
  assert.equal(cache.entries.get("/data/other.json").original.headers["Cache-Control"], "public, max-age=3600");
});

test("history data path matcher accepts only canonical, index and dated shards", () => {
  assert.equal(isHistoryDataPath("/data/history.json"), true);
  assert.equal(isHistoryDataPath(HISTORY_INDEX_PATH), true);
  assert.equal(isHistoryDataPath(`${HISTORY_DAYS_PREFIX}2026-10-22.json`), true);
  assert.equal(isHistoryDataPath(`${HISTORY_DAYS_PREFIX}not-a-date.json`), false);
  assert.equal(isHistoryDataPath("/data/history-days/2026-10-22.json.br"), false);
  assert.equal(isHistoryDataPath("/data/other.json"), false);
});

function historyEntry() {
  return {
    original: { headers: { "Cache-Control": "public, max-age=3600", ETag: 'W/"history-etag"' } },
    br: { headers: { "Cache-Control": "public, max-age=3600", ETag: 'W/"history-etag"', Vary: "Accept-Encoding" } },
    gz: { headers: { "Cache-Control": "public, max-age=3600", ETag: 'W/"history-etag"', Vary: "Accept-Encoding" } },
    notModifiedHeaders: { "Cache-Control": "public, max-age=3600", ETag: 'W/"history-etag"', Vary: "Accept-Encoding" },
  };
}
