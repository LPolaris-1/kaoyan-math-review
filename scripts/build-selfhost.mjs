#!/usr/bin/env node
// Self-hosted production build wrapper.
// Sets SELF_HOSTED_BUILD=1 so vite.config.ts switches to the native vinext
// Node build (no sites()/cloudflare() plugins) and aliases `cloudflare:workers`
// to the local node:sqlite shim. Invokes the project-installed vinext CLI with
// process.execPath only -- no shell, no cross-env, works on Windows and Linux.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(
  projectRoot,
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);

process.env.SELF_HOSTED_BUILD = "1";

const result = spawnSync(process.execPath, [cliPath, "build"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[build:selfhost] Failed to run vinext CLI: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);