#!/usr/bin/env node
// Self-hosted production build wrapper.
// Sets SELF_HOSTED_BUILD=1 so vite.config.ts switches to the native vinext
// Node build (no sites()/cloudflare() plugins) and aliases `cloudflare:workers`
// to the local node:sqlite shim. Invokes the project-installed vinext CLI with
// process.execPath only -- no shell, no cross-env, works on Windows and Linux.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
if ((result.status ?? 1) === 0) {
  const metadata = {
    git_commit: gitValue(["rev-parse", "HEAD"], "unknown"),
    branch: gitValue(["branch", "--show-current"], "unknown"),
    built_at: new Date().toISOString(),
    mode: "selfhost",
  };
  fs.writeFileSync(
    path.join(projectRoot, "dist", "RELEASE.json"),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8",
  );
}

process.exit(result.status ?? 1);

function gitValue(args, fallback) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}
