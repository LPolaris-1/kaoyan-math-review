import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmEntry = process.env.npm_execpath;
const steps = [
  ["data:build", process.execPath, [path.join(projectDir, "scripts", "build-review.mjs")]],
  ["npm test", process.execPath, [npmEntry, "test"]],
  ["data:verify", process.execPath, [path.join(projectDir, "scripts", "verify-data.mjs")]],
];

for (const [name, command, args] of steps) {
  console.log("Running " + name);
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(name + " failed: " + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(name + " failed with exit code " + result.status);
    process.exit(result.status || 1);
  }
}

console.log("data:check passed");
