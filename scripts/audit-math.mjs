// Read-only math debt audit over all source markdown files.
// Reports files/lines where unwrapped plain-text math appears, using the
// same detection logic as the LaTeX import gate. Never writes sources.
//
// Usage:
//   node scripts/audit-math.mjs            # human report, exit 0
//   node scripts/audit-math.mjs --strict   # exit 1 when issues exist
//   node scripts/audit-math.mjs --json     # machine-readable JSON on stdout

import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_DIR, walk, parseMarkdownFile } from "./shared/data-lib.mjs";
import { findPlainMath } from "./shared/math-gate.mjs";

export function parseAuditArgs(argv = []) {
  return { strict: argv.includes("--strict"), json: argv.includes("--json") };
}

export function auditEntries(entries) {
  const issues = [];
  for (const entry of entries) {
    issues.push(...findPlainMath(entry.body, entry.filePath));
  }
  return { files: entries.length, issues, issueCount: issues.length };
}

export function auditExitCode(issueCount, strict) {
  return strict && issueCount > 0 ? 1 : 0;
}

export function formatAuditReport(result) {
  const lines = [`Math audit: scanned ${result.files} file(s), found ${result.issueCount} issue(s)`];
  for (const issue of result.issues) {
    lines.push(`  ${issue.filePath}:${issue.lineNumber}`);
    lines.push(`    ${issue.snippet}`);
    lines.push(`    检测到：${issue.signals.join("、")}。${issue.message}`);
  }
  return lines.join("\n");
}

function main() {
  const args = parseAuditArgs(process.argv.slice(2));
  const mdFiles = walk(SOURCE_DIR).filter((fp) => fp.toLowerCase().endsWith(".md"));
  const entries = mdFiles.map((filePath) => {
    const { body, relativePath } = parseMarkdownFile(filePath);
    return { filePath: relativePath, body };
  });
  const result = auditEntries(entries);
  const exitCode = auditExitCode(result.issueCount, args.strict);
  if (args.json) {
    console.log(JSON.stringify({ ...result, strict: args.strict, exitCode }, null, 2));
  } else {
    console.log(formatAuditReport(result));
  }
  process.exit(exitCode);
}

const invokedAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) main();
