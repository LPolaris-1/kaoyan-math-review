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
