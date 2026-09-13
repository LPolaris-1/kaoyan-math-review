#!/usr/bin/env node
// Read-only source inventory and canonical path/time-boundary gate.
import { SOURCE_DIR, inspectSourceBoundary } from "./shared/data-lib.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === "--json") args.set("json", true);
  else if (value === "--since") args.set("since", process.argv[++index]);
}

const report = inspectSourceBoundary(SOURCE_DIR, { since: args.get("since") ?? null });
if (args.get("json")) {
  console.log(JSON.stringify({
    sourceDir: report.sourceDir,
    fileCount: report.fileCount,
    modifiedToday: report.modifiedToday.map((file) => file.relativePath),
    modifiedSince: report.modifiedSince.map((file) => file.relativePath),
    latestMtime: report.latestMtime,
    issues: report.issues,
    warnings: report.warnings,
  }, null, 2));
} else {
  console.log(`source boundary: ${report.sourceDir}`);
  console.log(`Markdown files: ${report.fileCount}`);
  console.log(`Modified today: ${report.modifiedToday.length}`);
  if (args.get("since")) console.log(`Modified since ${args.get("since")}: ${report.modifiedSince.length}`);
  console.log(`Latest mtime: ${report.latestMtime ?? "none"}`);
  for (const warning of report.warnings) console.warn(`WARN ${warning}`);
  for (const issue of report.issues) console.error(`FAIL ${issue.code}: ${issue.message}`);
}

process.exitCode = report.issues.length > 0 ? 1 : 0;
