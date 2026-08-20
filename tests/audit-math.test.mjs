// Tests for the read-only math debt audit command helpers.
// No Vault or history.json access.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAuditArgs,
  auditEntries,
  auditExitCode,
  formatAuditReport,
} from "../scripts/audit-math.mjs";

test("parseAuditArgs: defaults to report-only", () => {
  assert.deepStrictEqual(parseAuditArgs([]), { strict: false, json: false });
  assert.deepStrictEqual(parseAuditArgs(["--strict", "--json"]), { strict: true, json: true });
});

test("auditExitCode: only --strict fails on issues", () => {
  assert.strictEqual(auditExitCode(0, false), 0);
  assert.strictEqual(auditExitCode(0, true), 0);
  assert.strictEqual(auditExitCode(3, false), 0);
  assert.strictEqual(auditExitCode(3, true), 1);
});

test("auditEntries: aggregates files and issues with locations", () => {
  const entries = [
    { filePath: "a.md", body: "求极限 lim[n→∞] 未包裹" },
    { filePath: "b.md", body: "```\nlim[n→∞]\n```\n$x^2$" },
  ];
  const result = auditEntries(entries);
  assert.strictEqual(result.files, 2);
  assert.strictEqual(result.issueCount, 1);
  assert.strictEqual(result.issues[0].filePath, "a.md");
  assert.strictEqual(result.issues[0].lineNumber, 1);
  assert.ok(result.issues[0].snippet.includes("lim[n→∞]"));
});

test("formatAuditReport: includes totals, file, line and snippet", () => {
  const result = auditEntries([{ filePath: "a.md", body: "L = lim[n→∞] 未包裹" }]);
  const report = formatAuditReport(result);
  assert.match(report, /scanned 1 file\(s\), found 1 issue\(s\)/);
  assert.match(report, /a\.md:1/);
  assert.match(report, /lim\[n→∞\]/u);
});
