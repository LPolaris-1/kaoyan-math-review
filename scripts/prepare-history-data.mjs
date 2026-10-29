#!/usr/bin/env node
// Derive the browser-facing history index, per-day content shards and their
// Brotli/gzip variants from the canonical public/data/history.json.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DATA_DIR = path.join(projectDir, "public", "data");
export const HISTORY_FILE = "history.json";
export const HISTORY_INDEX_FILE = "history-index.json";
export const HISTORY_DAYS_DIR = "history-days";

const DERIVED_TARGETS = [
  "history.json.br",
  "history.json.gz",
  HISTORY_INDEX_FILE,
  `${HISTORY_INDEX_FILE}.br`,
  `${HISTORY_INDEX_FILE}.gz`,
  HISTORY_DAYS_DIR,
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertHistory(history) {
  if (!isRecord(history) || typeof history.generatedAt !== "string" || !Array.isArray(history.days)) {
    throw new Error("canonical history.json is missing generatedAt or days");
  }
  const seenDates = new Set();
  const seenIds = new Set();
  let itemCount = 0;
  for (const day of history.days) {
    if (!isRecord(day) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || "") || !Array.isArray(day.items)) {
      throw new Error("canonical history.json contains an invalid day");
    }
    if (seenDates.has(day.date)) throw new Error(`canonical history.json contains duplicate day: ${day.date}`);
    seenDates.add(day.date);
    if (day.count !== day.items.length) {
      throw new Error(`canonical history.json day count mismatch: ${day.date}`);
    }
    for (const item of day.items) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.content !== "string") {
        throw new Error(`canonical history.json contains an invalid item in ${day.date}`);
      }
      if (seenIds.has(item.id)) throw new Error(`canonical history.json contains duplicate item id: ${item.id}`);
      seenIds.add(item.id);
      itemCount += 1;
    }
  }
  if (history.totalDays !== history.days.length) {
    throw new Error(`canonical history.json totalDays=${history.totalDays} but days.length=${history.days.length}`);
  }
  if (history.totalNotes !== itemCount) {
    throw new Error(`canonical history.json totalNotes=${history.totalNotes} but items.length=${itemCount}`);
  }
}

export function buildDerivedArtifacts(history) {
  assertHistory(history);
  const days = history.days.map((day) => ({
    date: day.date,
    items: day.items.map((item) => ({ id: item.id, content: item.content })),
  }));
  const index = {
    ...history,
    days: history.days.map((day) => ({
      ...day,
      items: day.items.map((item) => {
        const metadata = { ...item };
        delete metadata.content;
        return metadata;
      }),
    })),
  };
  return { index, days };
}

export function compressBrotli(buffer) {
  return zlib.brotliCompressSync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
  });
}

export function compressGzip(buffer) {
  return zlib.gzipSync(buffer, { level: 8 });
}

function buildDerivedFileMap(history, historyBytes) {
  const { index, days } = buildDerivedArtifacts(history);
  const files = new Map();
  const add = (relativePath, buffer) => {
    files.set(relativePath, buffer);
    files.set(`${relativePath}.br`, compressBrotli(buffer));
    files.set(`${relativePath}.gz`, compressGzip(buffer));
  };

  add(HISTORY_FILE, historyBytes);
  add(HISTORY_INDEX_FILE, serializeJson(index));
  for (const day of days) {
    add(`${HISTORY_DAYS_DIR}/${day.date}.json`, serializeJson(day));
  }
  return { files, index, days };
}

function readCanonicalHistory(historyPath) {
  const absolute = historyPath;
  const bytes = fs.readFileSync(absolute);
  let history;
  try {
    history = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid canonical history JSON at ${absolute}: ${error.message}`);
  }
  assertHistory(history);
  return { history, bytes };
}

function compareBytes(issues, label, actual, expected) {
  if (!actual.equals(expected)) issues.push(`${label} bytes do not match canonical output`);
}

function decompressVariant(relativePath, buffer) {
  if (relativePath.endsWith(".br")) return zlib.brotliDecompressSync(buffer);
  if (relativePath.endsWith(".gz")) return zlib.gunzipSync(buffer);
  throw new Error(`unsupported compressed variant: ${relativePath}`);
}

export function findDerivedArtifactIssues(history, dataDir = DEFAULT_DATA_DIR, options = {}) {
  const issues = [];
  let expected;
  try {
    expected = buildDerivedArtifacts(history);
  } catch (error) {
    return [error.message];
  }

  let historyBytes = options.historyBytes;
  if (!historyBytes) {
    try {
      historyBytes = fs.readFileSync(path.join(dataDir, HISTORY_FILE));
    } catch (error) {
      issues.push(`missing canonical ${HISTORY_FILE}: ${error.message}`);
    }
  }

  let indexBytes;
  try {
    indexBytes = serializeJson(expected.index);
  } catch (error) {
    issues.push(`cannot serialize ${HISTORY_INDEX_FILE}: ${error.message}`);
    return issues;
  }

  const verifyPlain = (relativePath, expectedBytes) => {
    try {
      const actual = fs.readFileSync(path.join(dataDir, relativePath));
      compareBytes(issues, relativePath, actual, expectedBytes);
    } catch (error) {
      issues.push(`missing ${relativePath}: ${error.message}`);
    }
  };
  const verifyCompressed = (relativePath, expectedBytes) => {
    try {
      const actual = fs.readFileSync(path.join(dataDir, relativePath));
      const decompressed = decompressVariant(relativePath, actual);
      compareBytes(issues, relativePath, decompressed, expectedBytes);
    } catch (error) {
      issues.push(`invalid ${relativePath}: ${error.message}`);
    }
  };

  if (historyBytes) {
    verifyCompressed(`${HISTORY_FILE}.br`, historyBytes);
    verifyCompressed(`${HISTORY_FILE}.gz`, historyBytes);
  }
  verifyPlain(HISTORY_INDEX_FILE, indexBytes);
  verifyCompressed(`${HISTORY_INDEX_FILE}.br`, indexBytes);
  verifyCompressed(`${HISTORY_INDEX_FILE}.gz`, indexBytes);

  const expectedDayFiles = new Set();
  for (const day of expected.days) {
    const relativePath = `${HISTORY_DAYS_DIR}/${day.date}.json`;
    const dayBytes = serializeJson(day);
    expectedDayFiles.add(`${day.date}.json`);
    expectedDayFiles.add(`${day.date}.json.br`);
    expectedDayFiles.add(`${day.date}.json.gz`);
    verifyPlain(relativePath, dayBytes);
    verifyCompressed(`${relativePath}.br`, dayBytes);
    verifyCompressed(`${relativePath}.gz`, dayBytes);
  }

  const daysDir = path.join(dataDir, HISTORY_DAYS_DIR);
  try {
    for (const entry of fs.readdirSync(daysDir, { withFileTypes: true })) {
      if (!entry.isFile() || !expectedDayFiles.has(entry.name)) {
        issues.push(`unexpected derived day artifact: ${HISTORY_DAYS_DIR}/${entry.name}`);
      }
    }
  } catch (error) {
    issues.push(`missing ${HISTORY_DAYS_DIR}: ${error.message}`);
  }

  return issues;
}

export function verifyDerivedArtifacts(history, dataDir = DEFAULT_DATA_DIR, options = {}) {
  const issues = findDerivedArtifactIssues(history, dataDir, options);
  if (issues.length > 0) {
    throw new Error(`derived history verification failed:\n${issues.join("\n")}`);
  }
  return { days: history.days.length, items: history.totalNotes };
}

function writeStagedFiles(stageDir, files) {
  for (const [relativePath, buffer] of files) {
    const destination = path.join(stageDir, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
  }
}

function swapDerivedArtifacts(stageDir, dataDir, history, historyBytes) {
  let backupDir;
  const moved = [];
  const installed = [];
  try {
    backupDir = fs.mkdtempSync(path.join(dataDir, ".history-backup-"));
    for (const relativePath of DERIVED_TARGETS) {
      const target = path.join(dataDir, ...relativePath.split("/"));
      if (!fs.existsSync(target)) continue;
      const backup = path.join(backupDir, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(target, backup);
      moved.push(relativePath);
    }
    for (const relativePath of DERIVED_TARGETS) {
      const staged = path.join(stageDir, ...relativePath.split("/"));
      if (!fs.existsSync(staged)) throw new Error(`staged artifact is missing: ${relativePath}`);
      const target = path.join(dataDir, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(staged, target);
      installed.push(relativePath);
    }

    const issues = findDerivedArtifactIssues(history, dataDir, { historyBytes });
    if (issues.length > 0) {
      throw new Error(`generated derived history is invalid:\n${issues.join("\n")}`);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const relativePath of [...installed].reverse()) {
      try {
        fs.rmSync(path.join(dataDir, ...relativePath.split("/")), { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackErrors.push(`${relativePath}: ${rollbackError.message}`);
      }
    }
    for (const relativePath of [...moved].reverse()) {
      try {
        const backup = path.join(backupDir, ...relativePath.split("/"));
        const target = path.join(dataDir, ...relativePath.split("/"));
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(backup, target);
      } catch (rollbackError) {
        rollbackErrors.push(`${relativePath}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}\nrollback failed:\n${rollbackErrors.join("\n")}`, { cause: error });
    }
    throw error;
  } finally {
    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

export function prepareHistoryData(options = {}) {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const historyPath = options.historyPath ?? path.join(dataDir, HISTORY_FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  const { history, bytes: historyBytes } = readCanonicalHistory(historyPath);

  const existingIssues = findDerivedArtifactIssues(history, dataDir, { historyBytes });
  if (existingIssues.length === 0) {
    return { changed: false, days: history.days.length, items: history.totalNotes };
  }

  const { files, days } = buildDerivedFileMap(history, historyBytes);
  const stageDir = fs.mkdtempSync(path.join(dataDir, ".history-stage-"));
  try {
    writeStagedFiles(stageDir, files);
    const stagedIssues = findDerivedArtifactIssues(history, stageDir, { historyBytes });
    if (stagedIssues.length > 0) {
      throw new Error(`staged derived history is invalid:\n${stagedIssues.join("\n")}`);
    }
    swapDerivedArtifacts(stageDir, dataDir, history, historyBytes);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  return { changed: true, days: days.length, items: history.totalNotes };
}

const invokedAsMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  try {
    const result = prepareHistoryData();
    console.log(
      result.changed
        ? `Generated history index and ${result.days} day shards (${result.items} items)`
        : `History derived data is up to date (${result.days} days, ${result.items} items)`,
    );
  } catch (error) {
    console.error(`Failed to prepare derived history data: ${error.message}`);
    process.exit(1);
  }
}
