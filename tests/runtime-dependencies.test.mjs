import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectRuntimeDependencies } from "../scripts/verify-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("current project has the runtime dependency required by selfhost", () => {
  const report = inspectRuntimeDependencies(root);
  assert.deepEqual(report.errors, []);
  assert.equal(report.packages.find((pkg) => pkg.name === "vinext")?.installed, "0.0.50");
});

test("missing node_modules is reported before a release switch", () => {
  const fixture = makeFixture();
  try {
    fs.rmSync(path.join(fixture, "node_modules"), { recursive: true, force: true });
    const report = inspectRuntimeDependencies(fixture);
    assert.ok(report.errors.some((error) => error.includes("missing runtime dependency directory")));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("installed runtime version must match an exact package declaration", () => {
  const fixture = makeFixture("0.0.49");
  try {
    const report = inspectRuntimeDependencies(fixture);
    assert.ok(report.errors.some((error) => error.includes("version mismatch")));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

function makeFixture(version = "0.0.50") {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-verify-test-"));
  fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "node_modules", "vinext", "server"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "scripts", "start-selfhost.mjs"), "export {}\n");
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    devDependencies: { vinext: "0.0.50" },
  }));
  fs.writeFileSync(path.join(fixture, "node_modules", "vinext", "package.json"), JSON.stringify({
    name: "vinext",
    version,
    exports: { "./server/prod-server": "./server/prod-server.js" },
  }));
  fs.writeFileSync(path.join(fixture, "node_modules", "vinext", "server", "prod-server.js"), "export {}\n");
  return fixture;
}
