#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const LEGACY_STAGE_DAYS = new Map([
  [1, 2],
  [2, 4],
  [3, 7],
  [4, 15],
  [5, 30],
]);
const STAGE_MAP = new Map([
  [0, 0],
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 3],
  [5, 3],
  [6, 4],
]);

function parseMode(argv) {
  if (argv.length !== 1 || !["--dry-run", "--apply"].includes(argv[0])) {
    throw new Error("Usage: npm run db:migrate:schedule-v2 -- --dry-run|--apply");
  }
  return argv[0] === "--apply" ? "apply" : "dry-run";
}

function readVersion(db) {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row?.user_version ?? 0);
}

function tableColumns(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name),
  );
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function reviewedDateFromTimestamp(value) {
  if (typeof value !== "string" || !value.includes("T")) return null;
  const datePart = value.slice(0, 10);
  if (!isValidDate(datePart) || Number.isNaN(Date.parse(value))) return null;
  return datePart;
}

function planMigration(db) {
  const columns = tableColumns(db, "review_progress");
  if (!columns.has("user_email") || !columns.has("item_id") || !columns.has("review_stage") || !columns.has("next_review_date")) {
    throw new Error("review_progress is missing required legacy columns.");
  }
  const hasCycleStartedAt = columns.has("cycle_started_at");
  const hasLastResult = columns.has("last_result");
  const hasLastReviewedAt = columns.has("last_reviewed_at");
  const rows = db.prepare(`
    SELECT user_email, item_id, review_stage, next_review_date,
           ${hasCycleStartedAt ? "cycle_started_at" : "NULL AS cycle_started_at"},
           ${hasLastResult ? "last_result" : "NULL AS last_result"},
           ${hasLastReviewedAt ? "last_reviewed_at" : "NULL AS last_reviewed_at"}
      FROM review_progress
     ORDER BY user_email, item_id
  `).all();

  if (rows.length > 0 && !hasCycleStartedAt) {
    throw new Error("review_progress is missing cycle_started_at; refusing to infer legacy anchors.");
  }

  const changes = [];
  const stageCounts = {};
  const plannedRows = [];
  for (const row of rows) {
    const legacyStage = row.review_stage;
    if (!Number.isInteger(legacyStage) || !STAGE_MAP.has(legacyStage)) {
      throw new Error(`Invalid review_stage for ${row.user_email}/${row.item_id}: ${String(legacyStage)}`);
    }
    const cycleStartedAt = row.cycle_started_at;
    const emptyCycle = cycleStartedAt === null || cycleStartedAt === undefined || cycleStartedAt === "";
    if (emptyCycle && legacyStage !== 0 && legacyStage !== 1) {
      throw new Error(`Legacy stage ${legacyStage} has no cycle_started_at for ${row.user_email}/${row.item_id}.`);
    }
    if (!emptyCycle && !isValidDate(cycleStartedAt)) {
      throw new Error(`Invalid cycle_started_at for ${row.user_email}/${row.item_id}: ${String(cycleStartedAt)}`);
    }
    if (!isValidDate(row.next_review_date)) {
      throw new Error(`Invalid next_review_date for ${row.user_email}/${row.item_id}: ${String(row.next_review_date)}`);
    }

    const reviewStage = STAGE_MAP.get(legacyStage);
    let migratedCycleStartedAt = emptyCycle ? null : cycleStartedAt;
    if (emptyCycle && legacyStage === 1) {
      const reviewedDate = reviewedDateFromTimestamp(row.last_reviewed_at);
      const canRecover =
        row.last_result === "correct" &&
        reviewedDate !== null &&
        row.next_review_date === addDays(reviewedDate, 1);
      if (!canRecover) {
        throw new Error(`Legacy stage 1 has insufficient first-correct evidence for ${row.user_email}/${row.item_id}.`);
      }
      migratedCycleStartedAt = addDays(row.next_review_date, -1);
    }
    let nextReviewDate = row.next_review_date;
    const legacyDay = LEGACY_STAGE_DAYS.get(legacyStage);
    if (legacyDay !== undefined && migratedCycleStartedAt) {
      const oldStandardDate = addDays(migratedCycleStartedAt, legacyDay - 1);
      if (nextReviewDate === oldStandardDate) {
        const newTargetDay = reviewStage === 1 ? 4 : reviewStage === 2 ? 7 : 30;
        nextReviewDate = addDays(migratedCycleStartedAt, newTargetDay - 1);
      }
    }

    stageCounts[reviewStage] = (stageCounts[reviewStage] ?? 0) + 1;
    const changed =
      reviewStage !== legacyStage ||
      nextReviewDate !== row.next_review_date ||
      migratedCycleStartedAt !== (emptyCycle ? null : cycleStartedAt);
    if (changed) {
      changes.push({
        userEmail: row.user_email,
        itemId: row.item_id,
        reviewStage,
        nextReviewDate,
        cycleStartedAt: migratedCycleStartedAt,
      });
    }

    plannedRows.push({
      userEmail: row.user_email,
      itemId: row.item_id,
      reviewStage,
      nextReviewDate,
      cycleStartedAt: migratedCycleStartedAt,
    });
  }

  return {
    rows: rows.length,
    changes,
    stageCounts,
    hasCycleStartedAt,
    plannedRows,
  };
}

function applyMigration(db, plan) {
  if (!plan.hasCycleStartedAt && plan.changes.length > 0) {
    throw new Error("review_progress is missing cycle_started_at; refusing to write recovered anchors.");
  }
  const update = plan.changes.length > 0
    ? db.prepare(`
        UPDATE review_progress
           SET review_stage = ?, next_review_date = ?, cycle_started_at = ?
         WHERE user_email = ? AND item_id = ?
      `)
    : null;
  for (const change of plan.changes) {
    const result = update.run(
      change.reviewStage,
      change.nextReviewDate,
      change.cycleStartedAt,
      change.userEmail,
      change.itemId,
    );
    if (Number(result.changes) !== 1) {
      throw new Error(`Expected one row while updating ${change.userEmail}/${change.itemId}.`);
    }
  }

  for (const expected of plan.plannedRows) {
    const actual = db.prepare(`
      SELECT review_stage, next_review_date, cycle_started_at
        FROM review_progress
       WHERE user_email = ? AND item_id = ?
    `).get(expected.userEmail, expected.itemId);
    if (
      !actual ||
      actual.review_stage !== expected.reviewStage ||
      actual.next_review_date !== expected.nextReviewDate ||
      actual.cycle_started_at !== expected.cycleStartedAt
    ) {
      throw new Error(`Post-update verification failed for ${expected.userEmail}/${expected.itemId}.`);
    }
  }
  db.exec("PRAGMA user_version = 2");
}

function report(mode, status, version, plan) {
  console.log(JSON.stringify({
    command: "db:migrate:schedule-v2",
    mode,
    status,
    userVersionBefore: version,
    userVersionAfter: status === "applied" ? 2 : version,
    rows: plan?.rows ?? 0,
    changedRows: plan?.changes.length ?? 0,
    stageCounts: plan?.stageCounts ?? {},
  }, null, 2));
}

function main() {
  const mode = parseMode(process.argv.slice(2));
  const dbPath = process.env.REVIEW_DB_PATH;
  if (!dbPath) throw new Error("REVIEW_DB_PATH is required.");
  const resolvedPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Database file does not exist: ${resolvedPath}`);
  }

  const db = new DatabaseSync(resolvedPath, { readOnly: mode === "dry-run" });
  try {
    const version = readVersion(db);
    if (version === 2) {
      report(mode, "no-op", version, null);
      return;
    }
    if (version !== 0) {
      throw new Error(`Unsupported review schema user_version=${version}; expected 0 or 2.`);
    }

    if (mode === "dry-run") {
      const plan = planMigration(db);
      report(mode, "dry-run", version, plan);
      return;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const plan = planMigration(db);
      applyMigration(db, plan);
      db.exec("COMMIT");
      report(mode, "applied", version, plan);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

export { applyMigration, parseMode, planMigration, readVersion };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[db:migrate:schedule-v2] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
