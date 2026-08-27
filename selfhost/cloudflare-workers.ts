// Local D1-compatible stand-in for the Cloudflare Workers runtime module
// `cloudflare:workers`. Only used by the self-hosted production build
// (SELF_HOSTED_BUILD=1 in vite.config.ts aliases `cloudflare:workers` here).
//
// The app code keeps using drizzle-orm/d1 via `env.DB`; this shim supplies the
// small D1Database / D1PreparedStatement surface that the current queries need,
// backed by Node's built-in node:sqlite. The database file path comes from
// REVIEW_DB_PATH and is never created or cleared here without that variable.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Idempotent schema bootstrap. Existing databases (e.g. with real review
// progress) are left untouched; this only fills in missing tables/indexes and
// adds the nullable cycle anchor when upgrading the old schema.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS review_progress (
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
CREATE INDEX IF NOT EXISTS review_progress_due_idx
  ON review_progress (user_email, mastered, next_review_date);
CREATE TABLE IF NOT EXISTS review_events (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
CREATE INDEX IF NOT EXISTS review_events_item_time_idx
  ON review_events (user_email, item_id, occurred_at);
CREATE INDEX IF NOT EXISTS review_events_user_date_idx
  ON review_events (user_email, occurred_date);
`;

type D1Row = Record<string, unknown>;

class D1Statement {
  #stmt: StatementSync;
  #params: unknown[];

  constructor(stmt: StatementSync, params: unknown[] = []) {
    this.#stmt = stmt;
    this.#params = params;
  }

  bind(...values: unknown[]): D1Statement {
    return new D1Statement(this.#stmt, values);
  }

  async all(): Promise<{ results: D1Row[] }> {
    return { results: this.#stmt.all(...this.#params) as D1Row[] };
  }

  async run(): Promise<{ success: boolean; meta: Record<string, unknown> }> {
    const info = this.#stmt.run(...this.#params);
    return {
      success: true,
      meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
    };
  }

  async raw(): Promise<unknown[][]> {
    const rows = this.#stmt.all(...this.#params) as D1Row[];
    const columns = this.#stmt.columns().map((column) => column.name);
    return rows.map((row) => columns.map((name) => row[name]));
  }

  async first(): Promise<D1Row | null> {
    const row = this.#stmt.get(...this.#params);
    return row === undefined ? null : (row as D1Row);
  }
}

class D1Database {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  prepare(sql: string): D1Statement {
    return new D1Statement(this.#db.prepare(sql));
  }

  async batch(statements: D1Statement[]): Promise<Array<{ results: D1Row[] }>> {
    const results: Array<{ results: D1Row[] }> = [];
    this.#db.exec("BEGIN");
    try {
      for (const statement of statements) {
        results.push(await statement.all());
      }
      this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }
}

function openDatabase(): D1Database {
  const dbPath = process.env.REVIEW_DB_PATH;
  if (!dbPath) {
    throw new Error(
      "REVIEW_DB_PATH is not set. Self-hosted mode requires REVIEW_DB_PATH to point at a writable SQLite database file.",
    );
  }
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const sqlite = new DatabaseSync(resolvedPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(SCHEMA_SQL);
  ensureReviewProgressColumn(sqlite);
  return new D1Database(sqlite);
}

function ensureReviewProgressColumn(sqlite: DatabaseSync) {
  const columns = sqlite
    .prepare("PRAGMA table_info(review_progress)")
    .all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === "cycle_started_at")) {
    sqlite.exec("ALTER TABLE review_progress ADD COLUMN cycle_started_at text");
  }
}

let database: D1Database | null = null;

export const env = {
  get DB(): D1Database {
    if (!database) {
      database = openDatabase();
    }
    return database;
  },
};
