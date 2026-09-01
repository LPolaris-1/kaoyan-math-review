// Build history.json from source markdown files.
// Uses canonical gray-matter parsing via shared/data-lib.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clean, parseList, section, bullets,
  extractDate, localDate, groupByDate, parseMarkdownFile, titleFields,
  collectSourceEntries, summarizeAdmissions, sourceNeedsRefresh
} from "./shared/data-lib.mjs";
import { reportLatexGate, scanLatexGate } from "./shared/math-gate.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "public", "data");
const outputFile = path.join(outputDir, "history.json");

/**
 * Build a single note record from a markdown file.
 */
function buildNote(filePath, historicalDates) {
  const { fields, body, relativePath } = parseMarkdownFile(filePath);
  const date = extractDate(filePath, historicalDates.get(relativePath));
  if (!date) return null;

  const { titleMarkdown, title } = titleFields(body, path.basename(filePath, ".md"));
  const subject = clean(String(fields.subject || (filePath.includes("\\线代\\") ? "线代" : "高数")));
  const methods = parseList(fields.methods);
  const inlineTopic = body.match(/(?:\*\*)?(?:知识点|主题)(?:\*\*)?\s*[：:]\s*([^\n]+)/)?.[1] || "";
  const topic = clean(String(fields.topic || fields.source_section || inlineTopic).split(",")[0]);
  const question = section(body, ["题目", "问题"]);
  const keyPoints = bullets(body, ["考点", "核心公式", "技巧小结"]);
  const pitfalls = bullets(body, ["易错点", "考研防坑", "易错点 & 反思"]);
  const answer = section(body, ["答案", "最终答案", "核心结论"]);

  return {
    id: relativePath,
    date,
    titleMarkdown,
    title,
    subject,
    chapter: clean(String(fields.source_chapter || "")),
    topic,
    methods,
    question,
    keyPoints,
    pitfalls,
    answer,
    content: body,
    tags: parseList(fields.tags),
    sourcePath: relativePath,
  };
}

/**
 * Build the full history object.
 */
function buildHistory(historicalDates, sourceEntries) {
  const notes = sourceEntries
    .filter((entry) => entry.admission.status === "include")
    .map(({ filePath }) => buildNote(filePath, historicalDates))
    .filter(Boolean);
  const days = groupByDate(notes);
  return {
    generatedAt: new Date().toISOString(),
    source: "06-Resources/学习/考研/考研数学/错题本/原档案",
    totalNotes: notes.length,
    totalDays: days.length,
    days,
  };
}

function reportAdmissions(sourceEntries, historicalDates) {
  const summary = summarizeAdmissions(sourceEntries);
  console.log("");
  console.log("=== Wrong-question Admission Gate ===");
  console.log(`Included: ${summary.include.length}`);
  console.log(`Excluded: ${summary.exclude.length}`);
  console.log(`Manual confirmation required: ${summary.ambiguous.length}`);
  for (const entry of [...summary.exclude, ...summary.ambiguous]) {
    const rel = entry.relativePath;
    const label = entry.admission.status === "exclude" ? "EXCLUDE" : "AMBIGUOUS";
    console.log(`${label}\t${rel}\t${entry.admission.reason}`);
  }
  console.log("2026-08-31 source affiliation:");
  for (const entry of sourceEntries) {
    const lockedDate = historicalDates.get(entry.relativePath);
    let mtimeDate = null;
    try { mtimeDate = localDate(fs.statSync(entry.filePath).mtime); } catch { /* report-only */ }
    const effectiveDate = extractDate(entry.filePath, lockedDate);
    if (effectiveDate === "2026-08-31" || mtimeDate === "2026-08-31") {
      console.log(`${entry.relativePath}\t${entry.admission.status.toUpperCase()}\teffective=${effectiveDate || "NONE"}\tmtime=${mtimeDate || "NONE"}`);
    }
  }
  return summary;
}

/**
 * Strip generatedAt for comparison.
 */
function comparable(history) {
  if (!history) return null;
  const rest = { ...history };
  delete rest.generatedAt;
  return rest;
}

/**
 * Read existing history.json if it exists.
 */
function readExisting() {
  if (!fs.existsSync(outputFile)) return null;
  try { return JSON.parse(fs.readFileSync(outputFile, "utf8")); }
  catch { return null; }
}

// --- Main ---

const existing = readExisting();
const sourceEntries = collectSourceEntries();
const historicalDates = new Map(
  (existing?.days || []).flatMap((day) => (day.items || []).map((item) => [item.id, item.date]))
);
const admissionSummary = reportAdmissions(sourceEntries, historicalDates);
if (admissionSummary.ambiguous.length > 0) {
  console.error("Admission gate blocked: resolve every AMBIGUOUS source explicitly before rebuilding history.json.");
  process.exit(1);
}
const historicalContent = new Map(
  (existing?.days || []).flatMap((day) => (day.items || []).map((item) => [item.sourcePath || item.id, item.content]))
);
const changedSources = sourceEntries
  .filter((entry) => entry.admission.status === "include")
  .filter((entry) => sourceNeedsRefresh(entry, historicalContent));
const latexIssues = scanLatexGate(changedSources);
if (!reportLatexGate(latexIssues)) {
  process.exit(1);
}

const nextHistory = buildHistory(historicalDates, sourceEntries);

if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(nextHistory))) {
  console.log(`Unchanged ${outputFile}`);
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const json = JSON.stringify({ ...nextHistory, generatedAt: new Date().toISOString() }, null, 2);
const tmp = `${outputFile}.tmp`;
fs.writeFileSync(tmp, `${json}\n`, "utf8");
fs.renameSync(tmp, outputFile);
console.log(`Generated ${outputFile}`);
