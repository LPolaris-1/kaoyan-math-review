import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  applyMigration,
  parseMode,
  planMigration,
  readVersion,
} from "../scripts/migrate-schedule-v2.mjs";

function createLegacyDb(rows, { event = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-v2-migration-"));
  const dbPath = path.join(dir, "review.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE review_progress (
      user_email text NOT NULL,
      item_id text NOT NULL,
      mastery_level integer DEFAULT 0 NOT NULL,
      exam_frequency text DEFAULT 'unknown' NOT NULL,
      review_stage integer DEFAULT 0 NOT NULL,
      next_review_date text NOT NULL,
      cycle_started_at text,
      mastered integer DEFAULT 0 NOT NULL,
      last_reviewed_at text,
      last_result text,
      updated_at text NOT NULL,
      PRIMARY KEY (user_email, item_id)
    );
    CREATE TABLE review_events (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_email text NOT NULL,
      item_id text NOT NULL,
      event_type text NOT NULL,
      result text,
      occurred_at text NOT NULL,
      occurred_date text NOT NULL,
      cycle_started_at text,
      target_day integer,
      scheduled_date text,
      review_stage_before integer,
      review_stage_after integer,
      created_at text NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO review_progress
      (user_email, item_id, review_stage, next_review_date, cycle_started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-09-27T00:00:00.000Z')
  `);
  for (const row of rows) insert.run("test@local", row.id, row.stage, row.next, row.cycle);
  if (event) {
    db.prepare(`
      INSERT INTO review_events
        (user_email, item_id, event_type, occurred_at, occurred_date, created_at)
      VALUES ('test@local', 'event-item', 'review', '2026-09-27T00:00:00.000Z', '2026-09-27', '2026-09-27T00:00:00.000Z')
    `).run();
  }
  db.close();
  return { dir, dbPath };
}

function runMigration(dbPath, flag) {
  const mode = parseMode(flag ? [flag] : []);
  const db = new DatabaseSync(dbPath);
  try {
    const version = readVersion(db);
    if (version === 2) return { status: "no-op", version };
    if (version !== 0) throw new Error(`Unsupported review schema user_version=${version}`);
    if (mode === "dry-run") return { status: "dry-run", version, plan: planMigration(db) };

    db.exec("BEGIN IMMEDIATE");
    try {
      const plan = planMigration(db);
      applyMigration(db, plan);
      db.exec("COMMIT");
      return { status: "applied", version, plan };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function readProgress(dbPath) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT item_id, review_stage, next_review_date FROM review_progress ORDER BY item_id").all().map((row) => ({ ...row }));
  const version = db.prepare("PRAGMA user_version").get().user_version;
  const events = db.prepare("SELECT COUNT(*) AS count FROM review_events").get().count;
  db.close();
  return { rows, version, events };
}

const standardRows = [
  { id: "stage0", stage: 0, cycle: null, next: "2026-08-20" },
  { id: "stage1", stage: 1, cycle: "2026-08-20", next: "2026-08-21" },
  { id: "stage2", stage: 2, cycle: "2026-08-20", next: "2026-08-23" },
  { id: "stage3", stage: 3, cycle: "2026-08-20", next: "2026-08-26" },
  { id: "stage4", stage: 4, cycle: "2026-08-20", next: "2026-09-03" },
  { id: "stage5", stage: 5, cycle: "2026-08-20", next: "2026-09-18" },
  { id: "stage6", stage: 6, cycle: "2026-08-20", next: "2026-10-01" },
  { id: "hard", stage: 1, cycle: "2026-08-20", next: "2026-08-25" },
];

test("migration requires an explicit mode", () => {
  assert.throws(() => parseMode([]), /Usage:.*--dry-run\|--apply/);
  assert.throws(() => parseMode(["--other"]), /Usage:.*--dry-run\|--apply/);
});

test("dry-run reports the full mapping without writing rows or version", () => {
  const fixture = createLegacyDb(standardRows, { event: true });
  try {
    const before = readProgress(fixture.dbPath);
    const result = runMigration(fixture.dbPath, "--dry-run");
    assert.equal(result.status, "dry-run");
    assert.equal(result.plan.changes.length, 6);
    const after = readProgress(fixture.dbPath);
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("apply maps standard dates, preserves reinforcement dates and keeps events", () => {
  const fixture = createLegacyDb(standardRows, { event: true });
  try {
    const result = runMigration(fixture.dbPath, "--apply");
    assert.equal(result.status, "applied");
    const state = readProgress(fixture.dbPath);
    assert.equal(state.version, 2);
    assert.equal(state.events, 1);
    assert.deepEqual(state.rows, [
      { item_id: "hard", review_stage: 1, next_review_date: "2026-08-25" },
      { item_id: "stage0", review_stage: 0, next_review_date: "2026-08-20" },
      { item_id: "stage1", review_stage: 1, next_review_date: "2026-08-23" },
      { item_id: "stage2", review_stage: 1, next_review_date: "2026-08-23" },
      { item_id: "stage3", review_stage: 2, next_review_date: "2026-08-26" },
      { item_id: "stage4", review_stage: 3, next_review_date: "2026-09-18" },
      { item_id: "stage5", review_stage: 3, next_review_date: "2026-09-18" },
      { item_id: "stage6", review_stage: 4, next_review_date: "2026-10-01" },
    ]);

    const repeat = runMigration(fixture.dbPath, "--apply");
    assert.equal(repeat.status, "no-op");
    assert.deepEqual(readProgress(fixture.dbPath), state);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("invalid rows stop apply atomically", () => {
  const fixture = createLegacyDb([
    { id: "valid", stage: 1, cycle: "2026-08-20", next: "2026-08-21" },
    { id: "invalid", stage: 2, cycle: null, next: "2026-08-23" },
  ]);
  try {
    assert.throws(() => runMigration(fixture.dbPath, "--apply"), /no cycle_started_at/);
    const state = readProgress(fixture.dbPath);
    assert.equal(state.version, 0);
    assert.deepEqual(state.rows, [
      { item_id: "invalid", review_stage: 2, next_review_date: "2026-08-23" },
      { item_id: "valid", review_stage: 1, next_review_date: "2026-08-21" },
    ]);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
