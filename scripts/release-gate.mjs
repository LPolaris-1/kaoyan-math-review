import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const projectDir = path.resolve(import.meta.dirname, "..");

export const RELEASE_GATE_STEPS = Object.freeze([
  Object.freeze({ name: "lint", script: "lint", producesDist: false }),
  Object.freeze({ name: "tests", script: "test", producesDist: false }),
  Object.freeze({ name: "build", script: "build", producesDist: true }),
  Object.freeze({ name: "build:sites", script: "build:sites", producesDist: true }),
  Object.freeze({ name: "build:selfhost", script: "build:selfhost", producesDist: true }),
  Object.freeze({ name: "release:verify", script: "release:verify", producesDist: false }),
  Object.freeze({ name: "smoke:selfhost", script: "smoke:selfhost", producesDist: false }),
  Object.freeze({ name: "data:verify", script: "data:verify", producesDist: false }),
  Object.freeze({ name: "data:check", script: "data:check", producesDist: false }),
]);

export function validateReleaseGateSteps(steps) {
  const scripts = steps.map((step) => step.script);
  const sitesIndex = scripts.indexOf("build:sites");
  const selfhostIndex = scripts.indexOf("build:selfhost");
  const verifyIndex = scripts.indexOf("release:verify");
  const smokeIndex = scripts.indexOf("smoke:selfhost");

  if (sitesIndex === -1 || selfhostIndex === -1 || sitesIndex > selfhostIndex) {
    throw new Error("build:sites must run before build:selfhost");
  }
  if (verifyIndex < selfhostIndex) {
    throw new Error("release:verify must run after build:selfhost");
  }
  if (smokeIndex < verifyIndex) {
    throw new Error("smoke:selfhost must run after release:verify");
  }

  const distBuilds = steps.filter((step) => step.producesDist);
  if (distBuilds.at(-1)?.script !== "build:selfhost") {
    throw new Error("build:selfhost must be the final dist-producing build");
  }
}

export function runReleaseGate({
  steps = RELEASE_GATE_STEPS,
  runStep = runNpmStep,
  log = console.log,
} = {}) {
  validateReleaseGateSteps(steps);

  for (const [index, step] of steps.entries()) {
    log(`[release:gate] ${index + 1}/${steps.length} ${formatNpmCommand(step.script)}`);
    const result = runStep(step);
    if (result.error) {
      throw new Error(`${step.name} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const error = new Error(`${step.name} failed with exit code ${result.status}`);
      error.exitCode = result.status || 1;
      throw error;
    }
  }

  log("release:gate passed");
}

function runNpmStep(step) {
  const npmEntry = process.env.npm_execpath;
  if (!npmEntry) {
    return { error: new Error("npm_execpath is unavailable; run this gate with npm run release:gate") };
  }

  const npmArgs = step.script === "test"
    ? [npmEntry, "test"]
    : [npmEntry, "run", step.script];
  return spawnSync(process.execPath, npmArgs, {
    cwd: projectDir,
    stdio: "inherit",
    windowsHide: true,
  });
}

function formatNpmCommand(script) {
  return script === "test" ? "npm test" : `npm run ${script}`;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    runReleaseGate();
  } catch (error) {
    console.error(`[release:gate] ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}
