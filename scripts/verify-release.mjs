#!/usr/bin/env node
// Validate the immutable files required to run a self-host release.
// This intentionally excludes node_modules, databases, auth files and secrets.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? process.cwd());
const required = [
  "dist",
  "dist/RELEASE.json",
  "dist/client",
  "dist/client/assets",
  "dist/server",
  "package.json",
  "package-lock.json",
  "scripts/start-selfhost.mjs",
  "selfhost/static-assets.mjs",
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`missing required release file: ${relative}`);
}

const assets = collectFiles(path.join(root, "dist/client/assets"));
if (assets.length === 0) fail("required release directory is empty: dist/client/assets");
if (fs.existsSync(path.join(root, "dist/server/wrangler.json"))) {
  fail("selfhost release contains Sites-only dist/server/wrangler.json; rebuild with build:selfhost");
}

let metadata;
try {
  metadata = JSON.parse(fs.readFileSync(path.join(root, "dist/RELEASE.json"), "utf8"));
} catch (error) {
  fail(`invalid dist/RELEASE.json: ${error.message}`);
}

for (const key of ["git_commit", "branch", "built_at", "mode"]) {
  if (typeof metadata?.[key] !== "string" || metadata[key].trim() === "") {
    fail(`invalid RELEASE.json field: ${key}`);
  }
}
if (metadata.mode !== "selfhost") fail(`invalid RELEASE.json mode: ${metadata.mode}`);
if (Number.isNaN(Date.parse(metadata.built_at))) fail("invalid RELEASE.json field: built_at");

const head = gitHead(root);
if (head && metadata.git_commit !== head) {
  fail(`RELEASE.json git_commit mismatch: ${metadata.git_commit} != ${head}`);
}

const runtimeFiles = resolveRuntimeImports(root, "scripts/start-selfhost.mjs");
console.log(`release verification passed: ${assets.length} client assets, ${runtimeFiles.length} local runtime files`);
console.log(`provenance: ${metadata.git_commit} ${metadata.branch} ${metadata.mode}`);

function resolveRuntimeImports(projectRoot, entry) {
  const queue = [path.join(projectRoot, entry)];
  const seen = new Set();
  while (queue.length > 0) {
    const importer = queue.shift();
    if (seen.has(importer)) continue;
    seen.add(importer);
    const source = fs.readFileSync(importer, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/g)) {
      enqueueLocalImport(projectRoot, importer, match[1], queue);
    }
    for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
      enqueueLocalImport(projectRoot, importer, match[1], queue);
    }
  }
  return [...seen].map((file) => path.relative(projectRoot, file).replaceAll(path.sep, "/"));
}

function enqueueLocalImport(projectRoot, importer, specifier, queue) {
  if (!specifier.startsWith(".")) return;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.mjs"),
    path.join(base, "index.js"),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) {
    const relative = path.relative(projectRoot, base).replaceAll(path.sep, "/");
    fail(`missing runtime import: ${relative}`);
  }
  queue.push(resolved);
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function gitHead(projectRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fail(message) {
  console.error(`release verification failed: ${message}`);
  process.exit(1);
}
