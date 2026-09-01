// Shared data library for build-review.mjs and verify-data.mjs
// Canonical frontmatter/body extraction via gray-matter:
// fields = parsed.data, body = parsed.content (preserves LF/CRLF byte-exact).

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const VAULT_DIR = process.env.MATH_VAULT_DIR || "C:/Users/HUAWEI/Vault/猥琐凡人的仓库";
export const SOURCE_DIR = path.join(VAULT_DIR, "06-Resources", "学习", "考研", "考研数学", "错题本", "原档案");

/**
 * Parse a Markdown file using gray-matter as the single canonical
 * frontmatter/body parser.  body === parsed.content (retains LF/CRLF).
 */
export function parseMarkdownFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const relativePath = path.relative(VAULT_DIR, filePath).split(path.sep).join("/");
  return { filePath, raw, fields: parsed.data, body: parsed.content, relativePath };
}

/**
 * Walk a directory recursively, returning all files.
 */
export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  });
}

/**
 * Clean a string: remove markdown formatting, collapse whitespace.
 */
export function clean(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain-text variant of clean() for titles: keeps underscores so math
 * identifiers like a_{n+1} survive for search/compatibility.
 */
export function cleanTitle(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first H1 from a markdown body.
 * titleMarkdown keeps the raw heading content character-for-character
 * (including $, \(...\), \[...\], underscores and backslashes);
 * title is the plain-text/search compatible variant.
 */
export function titleFields(body, fallback = "") {
  const rawTitle = String(body || "").match(/^#\s+(.+)$/m)?.[1] || fallback;
  return {
    titleMarkdown: rawTitle.trim(),
    title: cleanTitle(rawTitle),
  };
}

/**
 * Extract the first date from a string, or null.
 */
export function matchDate(str) {
  const m = String(str).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/**
 * Local date string for a Date object.
 */
export function localDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Determine the effective date for a note.
 *
 * Priority:
 * 1. historicalDate (from existing history.json) — permanent lock
 * 2. birthtime — only if valid (not Unix epoch 1970-01-01)
 * 3. mtime — fallback if birthtime is invalid
 * 4. null — if all stat fails
 *
 * No date shifting on file modification. No body/filename date extraction.
 *
 * @param {string} filePath
 * @param {string|null} historicalDate
 * @param {function|null} _statFn — optional injection for testing; returns { birthtime, mtime } or null
 */
export function extractDate(filePath, historicalDate, _statFn) {
  if (historicalDate) return historicalDate;
  try {
    const st = _statFn ? _statFn(filePath) : fs.statSync(filePath);
    if (!st) return null;

    const bt = st.birthtime;
    const isBirthtimeValid = bt instanceof Date && !isNaN(bt) && bt.getTime() > 86400000;
    if (isBirthtimeValid) return localDate(bt);

    const mt = st.mtime;
    if (mt instanceof Date && !isNaN(mt)) return localDate(mt);

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a YAML list value (either inline [a,b] or multi-line - items).
 */
export function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => clean(String(item))).filter(Boolean);
  const str = String(value);
  const match = str.match(/^\[(.*)\]$/);
  if (match) return match[1].split(",").map((item) => clean(item.replace(/^['"]|['"]$/g, ""))).filter(Boolean);
  return str.split(/\n/).map((item) => clean(item.replace(/^[-*]\s*/, ""))).filter(Boolean);
}

const QUESTION_HEADING_MARKERS = ["题目", "原题", "题干", "问题", "命题", "原式", "题型", "典型题"];
const QUESTION_OPERATIVE_MARKERS = ["已知", "设", "若", "求", "计算", "证明", "判断", "选择", "下列"];
const PROCESS_MARKERS = [
  "解答", "解析", "解法", "解题", "求解", "推导", "证明", "步骤", "过程", "思路", "答案",
  "破题", "构造", "方法", "分析", "标准", "Step", "第一步", "第二步", "选项", "判断", "最终",
];
const MATH_DELIMITER_RE = /\$\$|\\\(|\\\[|\$/;
const HEADING_LINE_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * Split a markdown body into heading sections. Each section records the
 * heading level/title, the 0-based line index of the heading, and the raw
 * content lines until the next heading of any level (or end of body).
 */
function headingSections(body) {
  const lines = String(body || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(HEADING_LINE_RE);
    if (match) {
      if (current) sections.push(current);
      current = { level: match[1].length, title: match[2], index, contentLines: [] };
    } else if (current) {
      current.contentLines.push(lines[index]);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Group lines from `start` into paragraphs separated by blank lines.
 */
function splitParagraphs(lines, start) {
  const paragraphs = [];
  let current = [];
  for (let index = start; index < lines.length; index++) {
    if (!lines[index].trim()) {
      if (current.length) {
        paragraphs.push(current);
        current = [];
      }
    } else {
      current.push(lines[index]);
    }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

/**
 * Deterministic structural check for a concrete-question section: a heading
 * at level 2+ whose title carries a question marker, with non-empty section
 * content. "题型"/"典型题" additionally require operative wording or an
 * explicit math expression in the content.
 */
function isQuestionSection(section) {
  if (section.level < 2) return false;
  const title = cleanTitle(section.title);
  const markers = QUESTION_HEADING_MARKERS.filter((marker) => title.includes(marker));
  if (markers.length === 0) return false;
  const rawContent = section.contentLines.join("\n");
  if (!clean(rawContent)) return false;
  if (markers.some((marker) => marker === "题型" || marker === "典型题")) {
    const hasOperative = QUESTION_OPERATIVE_MARKERS.some((marker) => rawContent.includes(marker));
    if (!hasOperative && !MATH_DELIMITER_RE.test(rawContent)) return false;
  }
  return true;
}

/**
 * Content gate (question half): does the body contain a concrete question?
 * Pure deterministic heading-structure check, no natural-language judgment.
 */
export function hasQuestionEvidence(body) {
  return headingSections(body).some(isQuestionSection);
}

/**
 * Content gate (process half): after the concrete question, does the body
 * contain a solution/derivation/judgment process? A process-marker heading
 * counts when its whole subtree — from that heading up to the next
 * same-level or higher-level heading — contains non-empty content; headings
 * alone are not process evidence. Plain body paragraphs after the question
 * are also scanned; the question's own first paragraph is not process text.
 */
export function hasProcessEvidence(body) {
  const sections = headingSections(body);
  const questionIndex = sections.findIndex(isQuestionSection);
  if (questionIndex === -1) return false;

  for (let index = questionIndex + 1; index < sections.length; index++) {
    const section = sections[index];
    const title = cleanTitle(section.title);
    if (!PROCESS_MARKERS.some((marker) => title.includes(marker))) continue;
    const subtreeLines = [...section.contentLines];
    for (let next = index + 1; next < sections.length; next++) {
      if (sections[next].level <= section.level) break;
      subtreeLines.push(...sections[next].contentLines);
    }
    if (clean(subtreeLines.join("\n"))) return true;
  }

  const lines = String(body || "").split(/\r?\n/);
  const paragraphs = splitParagraphs(lines, sections[questionIndex].index + 1);
  for (let paragraphIndex = 1; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const text = paragraphs[paragraphIndex].filter((line) => !HEADING_LINE_RE.test(line)).join("\n");
    for (const marker of PROCESS_MARKERS) {
      const at = text.indexOf(marker);
      if (at !== -1 && text.slice(at + marker.length).trim()) return true;
    }
  }
  return false;
}

/**
 * Classify a source Markdown file for history import.
 *
 * Explicit frontmatter is authoritative. Full-text content is next: a body
 * containing both a concrete question and a solution/derivation process is
 * always included, even when legacy naming (方法 directory, 题型- basename,
 * pure knowledge-note names) would suggest exclusion. Those legacy hints only
 * provide an exclude reason for files that lack the full structure; every
 * remaining file fails closed — a "错题" basename or tag alone admits nothing.
 */
export function classifyAdmission({ relativePath, fields = {}, body = "" }) {
  const entryType = String(fields.entry_type || "").trim().toLowerCase();
  if (entryType === "wrong_question") {
    return { status: "include", reason: "entry_type: wrong_question" };
  }
  if (entryType === "knowledge") {
    return { status: "exclude", reason: "entry_type: knowledge" };
  }
  if (entryType) {
    return { status: "ambiguous", reason: `unsupported entry_type: ${entryType}` };
  }

  if (hasQuestionEvidence(body) && hasProcessEvidence(body)) {
    return { status: "include", reason: "content has concrete question and solution process" };
  }

  const normalized = String(relativePath).split("\\").join("/");
  const segments = normalized.split("/");
  const basename = segments.at(-1) || "";
  if (segments.includes("方法")) {
    return { status: "exclude", reason: "legacy 方法 directory" };
  }
  if (basename.startsWith("题型-")) {
    return { status: "exclude", reason: "legacy 题型- basename" };
  }

  // Only unambiguous pure knowledge-note naming is excluded automatically.
  if (/(推导|结论集|运算(?:和)?变换的区别)$/u.test(basename.replace(/\.md$/iu, ""))) {
    return { status: "exclude", reason: "legacy pure knowledge naming" };
  }

  return { status: "exclude", reason: "missing concrete question or solution process" };
}

/**
 * Parse and classify every Markdown source in one canonical collection.
 * Build and verify must consume this exact collection.
 */
export function collectSourceEntries(sourceDir = SOURCE_DIR) {
  return walk(sourceDir)
    .filter((filePath) => filePath.toLowerCase().endsWith(".md"))
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath);
      return {
        filePath,
        ...parsed,
        admission: classifyAdmission(parsed),
      };
    });
}

export function summarizeAdmissions(entries) {
  const summary = { include: [], exclude: [], ambiguous: [] };
  for (const entry of entries) summary[entry.admission.status].push(entry);
  return summary;
}

/**
 * Extract a markdown section by heading name.
 */
export function section(body, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = body.match(new RegExp(`^#{1,6}\\s*(?:${escaped})\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|$)`, "im"));
  return match ? clean(match[1]) : "";
}

/**
 * Extract bullet items from a section.
 */
export function bullets(body, names) {
  return section(body, names).split(/\s+-\s+|\s+\*\s+/).map(clean).filter(Boolean).slice(0, 5);
}

/**
 * Group notes by date into day records, sorted newest first.
 */
export function groupByDate(notes) {
  const byDate = new Map();
  for (const note of notes) {
    const date = note.date;
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(note);
  }
  return [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => {
    const subjectCounts = items.reduce((counts, item) => {
      counts[item.subject] = (counts[item.subject] || 0) + 1;
      return counts;
    }, {});
    const topics = [...new Set(items.map((item) => item.topic).filter(Boolean))].slice(0, 6);
    const takeaways = [...new Set(items.flatMap((item) => [...item.keyPoints, ...item.pitfalls]))].slice(0, 6);
    return {
      date,
      count: items.length,
      subjectCounts,
      topics,
      takeaways,
      summary: `${items.length} 道错题 · ${Object.entries(subjectCounts).map(([s, c]) => `${s} ${c} 道`).join("、")}`,
      items: items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    };
  });
}
