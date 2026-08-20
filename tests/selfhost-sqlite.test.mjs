// Self-hosted node:sqlite shim tests.
// Uses a throwaway temp directory only -- never touches the real database,
// the Vault, or public/data/history.json.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const shimUrl = pathToFileURL(
  path.join(projectRoot, "selfhost", "cloudflare-workers.ts"),
).href;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-sqlite-test-"));
const dbPath = path.join(tmpDir, "review.db");
process.env.REVIEW_DB_PATH = dbPath;

// Each load gets a fresh module instance (fresh DatabaseSync connection).
function loadShim(tag) {
  return import(`${shimUrl}?t=${tag}`);
}

let firstDb = null;

test("auto-creates review_progress table and due index on first access", async () => {
  const { env } = await loadShim("schema");
  const db = env.DB;
  firstDb = db;

  const objects = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'review_progress%' ORDER BY name",
    )
    .bind()
    .all();
  assert.deepEqual(
    objects.results.map((row) => row.name),
    ["review_progress", "review_progress_due_idx"],
  );
});

test("inserts a row and maps D1-shaped results back", async () => {
  const db = firstDb;
  const inserted = await db
    .prepare(
      `INSERT INTO review_progress
         (user_email, item_id, mastery_level, exam_frequency, review_stage,
          next_review_date, mastered, last_reviewed_at, last_result, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "selfhost@local",
      "高数/极限.md",
      3,
      "high",
      2,
      "2026-08-13",
      0,
      null,
      "wrong",
      "2026-08-13T00:00:00.000Z",
    )
    .run();
  assert.equal(inserted.success, true);

  const rows = await db
    .prepare(
      `SELECT user_email, item_id, mastery_level, exam_frequency, review_stage,
              next_review_date, mastered, last_reviewed_at, last_result, updated_at
       FROM review_progress WHERE user_email = ?`,
    )
    .bind("selfhost@local")
    .all();
  assert.equal(rows.results.length, 1);
  const row = rows.results[0];
  assert.equal(row.user_email, "selfhost@local");
  assert.equal(row.item_id, "高数/极限.md");
  assert.equal(row.mastery_level, 3);
  assert.equal(row.exam_frequency, "high");
  assert.equal(row.last_reviewed_at, null);
});

test("raw() returns rows as positional arrays in SQL column order", async () => {
  const db = firstDb;
  const raw = await db
    .prepare("SELECT user_email, item_id FROM review_progress")
    .bind()
    .raw();
  assert.deepEqual(raw, [["selfhost@local", "高数/极限.md"]]);
});

test("first() returns the leading row or null", async () => {
  const db = firstDb;
  const row = await db
    .prepare("SELECT item_id FROM review_progress WHERE user_email = ?")
    .bind("selfhost@local")
    .first();
  assert.equal(row.item_id, "高数/极限.md");

  const missing = await db
    .prepare("SELECT item_id FROM review_progress WHERE user_email = ?")
    .bind("nobody@local")
    .first();
  assert.equal(missing, null);
});

test("conflict update upserts instead of duplicating", async () => {
  const db = firstDb;
  await db
    .prepare(
      `INSERT INTO review_progress
         (user_email, item_id, mastery_level, exam_frequency, review_stage,
          next_review_date, mastered, last_reviewed_at, last_result, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_email, item_id) DO UPDATE SET
         mastery_level = excluded.mastery_level,
         updated_at = excluded.updated_at`,
    )
    .bind(
      "selfhost@local",
      "高数/极限.md",
      5,
      "high",
      2,
      "2026-08-13",
      0,
      null,
      "wrong",
      "2026-08-14T00:00:00.000Z",
    )
    .run();

  const rows = await db
    .prepare(
      "SELECT user_email, item_id, mastery_level FROM review_progress WHERE user_email = ?",
    )
    .bind("selfhost@local")
    .all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].mastery_level, 5);
});

test("batch() returns per-statement results in order", async () => {
  const db = firstDb;
  const results = await db.batch([
    db.prepare("SELECT item_id FROM review_progress"),
    db.prepare("SELECT mastery_level FROM review_progress"),
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].results[0].item_id, "高数/极限.md");
  assert.equal(results[1].results[0].mastery_level, 5);
});

test("data persists across a fresh connection (reopen)", async () => {
  firstDb.close();
  firstDb = null;

  const { env: reopened } = await loadShim("reopen");
  const db = reopened.DB;
  const rows = await db
    .prepare(
      "SELECT item_id, mastery_level FROM review_progress WHERE user_email = ?",
    )
    .bind("selfhost@local")
    .all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].item_id, "高数/极限.md");
  assert.equal(rows.results[0].mastery_level, 5);
  db.close();
});

test("fails fast without REVIEW_DB_PATH and does not leak the variable", async () => {
  const saved = process.env.REVIEW_DB_PATH;
  delete process.env.REVIEW_DB_PATH;
  try {
    const { env: missingEnv } = await loadShim("missing");
    assert.throws(() => missingEnv.DB, /REVIEW_DB_PATH is not set/);
  } finally {
    process.env.REVIEW_DB_PATH = saved;
  }
});

test.after(() => {
  try {
    firstDb?.close();
  } catch {
    // Already closed.
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; nothing in the repo is touched.
  }
});