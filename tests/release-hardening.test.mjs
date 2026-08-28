import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test("Sites-only server marker fails selfhost verification", () => {
  withFixture((fixture) => {
    fs.writeFileSync(path.join(fixture, "dist/server/wrangler.json"), "{}\n");
    const result = runVerify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sites-only dist\/server\/wrangler\.json/);
  });
});

test("selfhost smoke script serves pages, assets and history", () => {
  const result = spawnSync(process.execPath, ["scripts/smoke-selfhost.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /selfhost smoke passed/);
});

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
  for (const directory of ["dist/client/assets", "dist/server", "scripts", "selfhost"]) {
    fs.mkdirSync(path.join(fixture, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(fixture, "dist/client/assets/app.js"), "console.log('fixture');\n");
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

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
