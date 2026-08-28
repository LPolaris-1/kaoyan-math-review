import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEASE_GATE_STEPS,
  runReleaseGate,
  validateReleaseGateSteps,
} from "../scripts/release-gate.mjs";

const expectedScripts = [
  "lint",
  "test",
  "build",
  "build:sites",
  "build:selfhost",
  "release:verify",
  "smoke:selfhost",
  "data:verify",
  "data:check",
];

test("release gate uses the canonical step ordering", () => {
  assert.deepEqual(
    RELEASE_GATE_STEPS.map((step) => step.script),
    expectedScripts,
  );
  assert.doesNotThrow(() => validateReleaseGateSteps(RELEASE_GATE_STEPS));
});

test("release verification and smoke run only after the selfhost build", () => {
  const scripts = RELEASE_GATE_STEPS.map((step) => step.script);
  assert.ok(scripts.indexOf("release:verify") > scripts.indexOf("build:selfhost"));
  assert.ok(scripts.indexOf("smoke:selfhost") > scripts.indexOf("release:verify"));
});

test("selfhost build must be the final dist-producing build", () => {
  const movedSitesStep = [
    ...RELEASE_GATE_STEPS.filter((step) => step.script !== "build:sites"),
    RELEASE_GATE_STEPS.find((step) => step.script === "build:sites"),
  ];

  assert.throws(
    () => validateReleaseGateSteps(movedSitesStep),
    /build:sites must run before build:selfhost|build:selfhost must be the final dist-producing build/,
  );
});

test("release gate fails fast without running later steps", () => {
  const executed = [];

  assert.throws(
    () => runReleaseGate({
      runStep(step) {
        executed.push(step.script);
        return { status: step.script === "build:sites" ? 9 : 0 };
      },
      log() {},
    }),
    /build:sites failed with exit code 9/,
  );
  assert.deepEqual(executed, expectedScripts.slice(0, 4));
});
