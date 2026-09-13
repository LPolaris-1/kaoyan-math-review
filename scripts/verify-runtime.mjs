#!/usr/bin/env node
// Verify the runtime dependencies required by start-selfhost.mjs.
// The release artifact deliberately excludes node_modules; this check must run
// after the release has been bound to the server's immutable dependency tree.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_RUNTIME_DEPENDENCIES = Object.freeze([
  Object.freeze({ name: "vinext", entry: "vinext/server/prod-server" }),
]);

export function inspectRuntimeDependencies(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const errors = [];
  const packages = [];
  const packageJsonPath = path.join(root, "package.json");
  const nodeModulesPath = path.join(root, "node_modules");
  let packageJson = null;

  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    errors.push(`cannot read package.json: ${error.message}`);
  }

  let nodeModulesTarget = null;
  try {
    const stat = fs.lstatSync(nodeModulesPath);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      errors.push(`node_modules is not a directory or symlink: ${nodeModulesPath}`);
    }
    if (stat.isSymbolicLink()) {
      try {
        nodeModulesTarget = fs.realpathSync(nodeModulesPath);
      } catch (error) {
        errors.push(`node_modules symlink target is unavailable: ${error.message}`);
      }
    }
  } catch {
    errors.push(`missing runtime dependency directory: ${nodeModulesPath}`);
  }

  for (const dependency of REQUIRED_RUNTIME_DEPENDENCIES) {
    const declared = packageJson?.dependencies?.[dependency.name]
      ?? packageJson?.devDependencies?.[dependency.name];
    if (!declared) {
      errors.push(`${dependency.name} is not declared in package.json`);
      continue;
    }

    const packageRoot = path.join(nodeModulesPath, dependency.name);
    let installed;
    try {
      installed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    } catch (error) {
      errors.push(`cannot read installed ${dependency.name} metadata: ${error.message}`);
      continue;
    }

    const entryPath = resolvePackageEntry(packageRoot, installed, dependency.entry);
    if (!entryPath) {
      errors.push(`cannot resolve ${dependency.entry} from installed ${dependency.name}`);
      continue;
    }

    if (isExactVersion(declared) && installed.version !== declared) {
      errors.push(`${dependency.name} version mismatch: declared ${declared}, installed ${installed.version}`);
    }
    packages.push({
      name: dependency.name,
      declared,
      installed: installed.version || "unknown",
      entryPath,
      packageRoot,
    });
  }

  return {
    root,
    nodeModulesPath,
    nodeModulesTarget,
    packages,
    errors,
  };
}

export function assertRuntimeDependencies(projectRoot = process.cwd()) {
  const report = inspectRuntimeDependencies(projectRoot);
  if (report.errors.length > 0) {
    throw new Error(report.errors.join("; "));
  }
  return report;
}

function resolvePackageEntry(packageRoot, packageJson, entry) {
  const subpath = `./${entry.split("/").slice(1).join("/")}`;
  const exportRecord = packageJson.exports?.[subpath];
  const target = typeof exportRecord === "string"
    ? exportRecord
    : exportRecord?.import ?? exportRecord?.default;
  if (target) {
    const resolved = path.resolve(packageRoot, target);
    if (resolved.startsWith(`${path.resolve(packageRoot)}${path.sep}`) && fs.existsSync(resolved)) return resolved;
  }
  const fallback = path.resolve(packageRoot, entry.replace(`${packageJson.name}/`, ""));
  return fs.existsSync(fallback) ? fallback : null;
}

function isExactVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(String(value));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const report = assertRuntimeDependencies(path.resolve(process.argv[2] ?? process.cwd()));
    const details = report.packages.map((pkg) => `${pkg.name}@${pkg.installed}`).join(", ");
    const target = report.nodeModulesTarget ? ` -> ${report.nodeModulesTarget}` : "";
    console.log(`runtime verification passed: ${report.nodeModulesPath}${target}; ${details}`);
  } catch (error) {
    console.error(`[runtime:verify] ${error.message}`);
    process.exitCode = 1;
  }
}
