import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertNoCache, loadCanonicalHistory } from "../scripts/smoke-selfhost.mjs";

const root = path.resolve(import.meta.dirname, "..");
const verifyScript = path.join(root, "scripts/verify-release.mjs");

test("valid release passes completeness and provenance checks", () => {
  withFixture((fixture) => {
    const result = runVerify(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release verification passed/);
  });
});

test("missing RELEASE.json fails clearly", () => {
  withFixture((fixture) => {
    fs.rmSync(path.join(fixture, "dist/RELEASE.json"));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required release file: dist\/RELEASE\.json/);
  });
});

test("wrong release mode fails", () => {
  withFixture((fixture) => {
    const metadataPath = path.join(fixture, "dist/RELEASE.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.mode = "sites";
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid RELEASE\.json mode: sites/);
  });
});

test("git commit mismatch fails", () => {
  withFixture((fixture) => {
    const metadataPath = path.join(fixture, "dist/RELEASE.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.git_commit = "wrong-commit";
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /git_commit mismatch/);
  });
});

test("missing start script fails", () => {
  withFixture((fixture) => {
    fs.rmSync(path.join(fixture, "scripts/start-selfhost.mjs"));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required release file: scripts\/start-selfhost\.mjs/);
  });
});

test("missing static-assets runtime dependency fails", () => {
  withFixture((fixture) => {
    fs.rmSync(path.join(fixture, "selfhost/static-assets.mjs"));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required release file: selfhost\/static-assets\.mjs/);
  });
});

test("missing client assets directory fails", () => {
  withFixture((fixture) => {
    fs.rmSync(path.join(fixture, "dist/client/assets"), { recursive: true });
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required release file: dist\/client\/assets/);
  });
});

test("missing generated history index fails clearly", () => {
  withFixture((fixture) => {
    fs.rmSync(path.join(fixture, "dist/client/data/history-index.json"));
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required history file: dist\/client\/data\/history-index\.json/);
  });
});

test("Sites-only server marker fails selfhost verification", () => {
  withFixture((fixture) => {
    fs.writeFileSync(path.join(fixture, "dist/server/wrangler.json"), "{}\n");
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sites-only dist\/server\/wrangler\.json/);
  });
});

test("selfhost smoke script serves pages, assets and history", (t) => {
  const skipReason = selfhostSmokeSkipReason();
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  const result = spawnSync(process.execPath, ["scripts/smoke-selfhost.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /selfhost smoke passed/);
});

test("selfhost smoke accepts Fetch Headers and Node raw header objects", () => {
  assert.doesNotThrow(() => assertNoCache(new Headers({ "cache-control": "no-cache, must-revalidate" }), "/fetch"));
  assert.doesNotThrow(() => assertNoCache({ "cache-control": "no-cache, must-revalidate" }, "/node"));
  assert.throws(
    () => assertNoCache({ "cache-control": "public, max-age=3600" }, "/node"),
    /cache policy is public, max-age=3600; expected no-cache/,
  );
  assert.throws(() => assertNoCache(new Headers(), "/fetch"), /cache policy is missing; expected no-cache/);
});

test("selfhost smoke reads canonical history from an artifact-only release layout", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-data-test-"));
  try {
    const dataDir = path.join(fixture, "dist", "client", "data");
    writeHistoryFixture(dataDir, 1);

    const result = loadCanonicalHistory(fixture);
    assert.equal(result.dataDir, dataDir);
    assert.equal(result.history.totalNotes, 1);
    assert.equal(result.index.totalDays, 1);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("selfhost smoke prefers source-tree public/data over built dist data", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-data-test-"));
  try {
    writeHistoryFixture(path.join(fixture, "public", "data"), 2);
    writeHistoryFixture(path.join(fixture, "dist", "client", "data"), 1);

    const result = loadCanonicalHistory(fixture);
    assert.equal(result.dataDir, path.join(fixture, "public", "data"));
    assert.equal(result.history.totalNotes, 2);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("selfhost smoke fails clearly when canonical history data is absent", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-data-test-"));
  try {
    assert.throws(
      () => loadCanonicalHistory(fixture),
      /canonical history data not found; checked public[\\/]data, dist[\\/]client[\\/]data under /,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

function writeHistoryFixture(directory, totalNotes) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "history.json"), JSON.stringify({
    totalNotes,
    days: [{ date: "2026-01-01", items: [{ id: "one", content: "fixture" }] }],
  }));
  fs.writeFileSync(path.join(directory, "history-index.json"), JSON.stringify({
    totalNotes,
    totalDays: 1,
    days: [{ date: "2026-01-01", count: 1, items: [{ id: "one" }] }],
  }));
}

function withFixture(callback) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "release-verify-test-"));
  try {
    createFixture(fixture);
    callback(fixture);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function createFixture(fixture) {
  for (const directory of ["dist/client/assets", "dist/client/data/history-days", "dist/server", "scripts", "selfhost"]) {
    fs.mkdirSync(path.join(fixture, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(fixture, "dist/client/assets/app.js"), "console.log('fixture');\n");
  fs.writeFileSync(path.join(fixture, "dist/client/data/history.json"), "{\"days\":[]}\n");
  fs.writeFileSync(path.join(fixture, "dist/client/data/history-index.json"), JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    totalNotes: 1,
    totalDays: 1,
    days: [{ date: "2026-01-01", count: 1, items: [{ id: "one" }] }],
  }));
  for (const file of [
    "history.json.br", "history.json.gz",
    "history-index.json.br", "history-index.json.gz",
    "history-days/2026-01-01.json",
    "history-days/2026-01-01.json.br",
    "history-days/2026-01-01.json.gz",
  ]) {
    fs.writeFileSync(path.join(fixture, "dist/client/data", file), "fixture");
  }
  fs.writeFileSync(path.join(fixture, "dist/RELEASE.json"), JSON.stringify({
    git_commit: "pending",
    branch: "main",
    built_at: "2026-01-01T00:00:00.000Z",
    mode: "selfhost",
  }));
  fs.writeFileSync(path.join(fixture, "package.json"), "{}\n");
  fs.writeFileSync(path.join(fixture, "package-lock.json"), "{}\n");
  fs.writeFileSync(path.join(fixture, "scripts/start-selfhost.mjs"), "import '../selfhost/static-assets.mjs';\n");
  fs.writeFileSync(path.join(fixture, "selfhost/static-assets.mjs"), "export const fixture = true;\n");
  runGit(fixture, ["init", "-q"]);
  runGit(fixture, ["config", "user.email", "test@example.invalid"]);
  runGit(fixture, ["config", "user.name", "release-test"]);
  runGit(fixture, ["add", "."]);
  runGit(fixture, ["commit", "-qm", "fixture"]);
  const head = runGit(fixture, ["rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(path.join(fixture, "dist/RELEASE.json"), JSON.stringify({
    git_commit: head,
    branch: "main",
    built_at: "2026-01-01T00:00:00.000Z",
    mode: "selfhost",
  }));
}

function runVerify(fixture) {
  return spawnSync(process.execPath, [verifyScript, fixture], { encoding: "utf8" });
}

function selfhostSmokeSkipReason() {
  const releasePath = path.join(root, "dist/RELEASE.json");
  const historyIndexPath = path.join(root, "dist/client/data/history-index.json");
  if (!fs.existsSync(releasePath)) {
    return "dist/RELEASE.json is missing; the real selfhost smoke runs in release:gate after the final build:selfhost";
  }
  if (!fs.existsSync(historyIndexPath)) {
    return "dist/client/data/history-index.json is missing; the real selfhost smoke runs in release:gate after the final build:selfhost";
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  } catch {
    return "dist/RELEASE.json is not valid provenance; the real selfhost smoke runs in release:gate after the final build:selfhost";
  }

  const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (headResult.error || headResult.status !== 0) {
    return "current git HEAD is unavailable; the real selfhost smoke runs in release:gate after the final build:selfhost";
  }
  if (metadata.git_commit !== headResult.stdout.trim()) {
    return `dist/RELEASE.json provenance is behind git HEAD (${metadata.git_commit} != ${headResult.stdout.trim()}); the real selfhost smoke runs in release:gate after the final build:selfhost`;
  }

  return null;
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
