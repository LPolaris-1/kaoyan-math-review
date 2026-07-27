// Verify history.json against source markdown files.
// Reports: content byte-exact match, path uniqueness, count consistency,
// LaTeX delimiter counts, matrix transpose notation, GFM table counts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VAULT_DIR, SOURCE_DIR, walk, parseMarkdownFile
} from "./shared/data-lib.mjs";
import { collectMathSegments } from "../app/math-content.mjs";
import katex from "katex";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(projectDir, "public", "data", "history.json");

function esc(str) {
  return JSON.stringify(str).slice(1, -1);
}

// Count occurrences of a regex in a string
function countRe(pattern, str) {
  return (str.match(pattern) || []).length;
}

/**
 * Count LaTeX delimiter occurrences in a string.
 */
function countLatex(body) {
  return {
    display: countRe(/\$\$/g, body),      // $$
    inline: countRe(/(?<!\$)\$(?!\$)/g, body), // single $
    bracketParen: countRe(/\\\(/g, body),  // \(
    bracketSquare: countRe(/\\\[/g, body), // \[
  };
}

/**
 * Count GFM table rows in body.
 */
function countTables(body) {
  // Count separator lines (|---|) as proxy for table count
  return countRe(/^\|[-\s|:]+\|$/gm, body);
}

/**
 * Find non-LaTeX plain transpose patterns.
 * Matches A^T, P^T outside $...$ delimiters, plus Unicode 撇号 variants.
 */
function findPlainTranspose(body) {
  const issues = [];
  // Remove all LaTeX math blocks: $...$ and $$...$$
  const noMath = body.replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$(?!\$)[^$\n]+?\$/g, "");

  // Plain A^T, P^T, (AB)^T outside math mode
  const plain = noMath.match(/\b[A-Za-z0-9]+\^T\b/g);
  if (plain) {
    for (const m of plain) {
      issues.push(`plain transpose: "${m}" (outside $...$ math mode)`);
    }
  }

  // Unicode superscript T: Aᵀ
  const uni = noMath.match(/[A-Za-z0-9]\u1D40/g);
  if (uni) {
    issues.push(`${uni.length} Unicode transpose character(s) found`);
  }


  return issues;
}

// --- Main ---

const history = JSON.parse(fs.readFileSync(outputFile, "utf8"));

// Build canonical source file set (forward-slash relative paths)
const srcPaths = walk(SOURCE_DIR).filter((fp) => fp.toLowerCase().endsWith(".md"));
const canonicalSrcIds = new Set(
  srcPaths.map((fp) => path.relative(VAULT_DIR, fp).split(path.sep).join("/"))
);

const allItems = history.days.flatMap((day) => day.items);
const historyCanonicalIds = new Set(allItems.map((item) => item.sourcePath));
let errors = 0;

// --- Count checks ---
if (history.totalNotes !== srcPaths.length) {
  console.error(`FAIL totalNotes=${history.totalNotes} but items.length=${allItems.length}`);
  errors++;
}
if (history.totalDays !== history.days.length) {
  console.error(`FAIL totalDays=${history.totalDays} but days.length=${history.days.length}`);
  errors++;
}

// --- Uniqueness & non-empty ---
for (const item of allItems) {
  if (!item.content) {
    console.error(`FAIL empty content: ${item.id}`);
    errors++;
  }
}

// --- Dedup check ---
const pathCounts = new Map();
const idCounts = new Map();
for (const item of allItems) {
  pathCounts.set(item.sourcePath, (pathCounts.get(item.sourcePath) || 0) + 1);
  idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
}
for (const [p, c] of pathCounts) {
  if (c > 1) { console.error(`FAIL duplicate sourcePath: ${p} (${c}x)`); errors++; }
}
for (const [id, c] of idCounts) {
  if (c > 1) { console.error(`FAIL duplicate id: ${id} (${c}x)`); errors++; }
}

// --- Canonical Set cross-check (size-insensitive) ---
const missing = [...canonicalSrcIds].filter((id) => !historyCanonicalIds.has(id));
for (const id of missing) {
  console.error(`FAIL missing from history: ${id}`);
  errors++;
}
const extra = [...historyCanonicalIds].filter((id) => !canonicalSrcIds.has(id));
for (const id of extra) {
  console.error(`FAIL extra in history (no source): ${id}`);
  errors++;
}

// --- Content byte-exact match ---
for (const item of allItems) {
  const srcPath = path.join(VAULT_DIR, item.sourcePath);
  if (!fs.existsSync(srcPath)) {
    console.error(`FAIL source not found: ${srcPath}`);
    errors++;
    continue;
  }

  const { body } = parseMarkdownFile(srcPath);

  if (item.content !== body) {
    let offset = 0;
    const minLen = Math.min(item.content.length, body.length);
    while (offset < minLen && item.content[offset] === body[offset]) offset++;

    const diffType = body.length > item.content.length && body.startsWith(item.content)
      ? "history shorter (missing suffix)"
      : item.content.length > body.length && item.content.startsWith(body)
      ? "history longer (extra suffix)"
      : body.length > item.content.length && body.endsWith(item.content)
      ? "history shorter (missing prefix)"
      : item.content.length > body.length && item.content.endsWith(body)
      ? "history longer (extra prefix)"
      : "structural difference";

    console.error(`FAIL content mismatch: ${item.sourcePath}`);
    console.error(`  offset: ${offset}`);
    console.error(`  expected len: ${body.length}, actual len: ${item.content.length}`);
    console.error(`  type: ${diffType}`);
    console.error(`  expected(~20): ${esc(body.slice(Math.max(0, offset - 20), offset + 20))}`);
    console.error(`  actual  (~20): ${esc(item.content.slice(Math.max(0, offset - 20), offset + 20))}`);

    errors++;
  }
}

// --- LaTeX delimiter report ---
console.log("");
console.log("=== LaTeX Delimiter Gate ===");
const srcLatexAgg = { display: 0, inline: 0, bracketParen: 0, bracketSquare: 0 };
const histLatexAgg = { display: 0, inline: 0, bracketParen: 0, bracketSquare: 0 };
let latexErrors = 0;

for (const item of allItems) {
  const srcPath = path.join(VAULT_DIR, item.sourcePath);
  if (!fs.existsSync(srcPath)) continue;

  const { body: srcBody } = parseMarkdownFile(srcPath);
  const src = countLatex(srcBody);
  const hist = countLatex(item.content);

  for (const k of Object.keys(src)) {
    srcLatexAgg[k] += src[k];
    histLatexAgg[k] += hist[k];
  }

  if (JSON.stringify(src) !== JSON.stringify(hist)) {
    console.error(`LaTeX mismatch: ${item.sourcePath} src=${JSON.stringify(src)} hist=${JSON.stringify(hist)}`);
    latexErrors++;
  }
}
console.log(`Source    totals: display=$$ ${srcLatexAgg.display}, inline=$ ${srcLatexAgg.inline}, \\(=${srcLatexAgg.bracketParen}, \\[=${srcLatexAgg.bracketSquare}`);
console.log(`History   totals: display=$$ ${histLatexAgg.display}, inline=$ ${histLatexAgg.inline}, \\(=${histLatexAgg.bracketParen}, \\[=${histLatexAgg.bracketSquare}`);
console.log(`LaTeX delimiters: ${latexErrors === 0 ? "PASS" : `${latexErrors} FILE(S) MISMATCH`}`);
if (latexErrors > 0) errors += latexErrors;

// --- Matrix transpose report (source quality warning only) ---
console.log("");
console.log("=== Matrix Transpose Gate ===");
let transposeMismatch = 0;

for (const item of allItems) {
  const srcPath = path.join(VAULT_DIR, item.sourcePath);
  if (!fs.existsSync(srcPath)) continue;

  const { body: srcBody } = parseMarkdownFile(srcPath);
  const srcIssues = findPlainTranspose(srcBody);
  const histIssues = findPlainTranspose(item.content);

  if (srcIssues.length !== histIssues.length) {
    console.error(`Transpose warn mismatch: ${item.sourcePath} src=${srcIssues.length} hist=${histIssues.length}`);
    transposeMismatch++;
  } else if (srcIssues.length > 0) {
    for (const iss of srcIssues) console.error(`Source notation warning: ${item.sourcePath}: ${iss}`);
  }
}

if (transposeMismatch > 0) {
  console.error(`Transpose warn counts: ${transposeMismatch} file(s) mismatch between source and history`);
  errors += transposeMismatch;
} else {
  console.log("Source notation warnings preserved exactly");
}
// --- GFM Table report ---
console.log("");
console.log("=== GFM Table Gate ===");
const srcTables = srcPaths.reduce((s, fp) => s + countTables(fs.readFileSync(fp, "utf8")), 0);
const histTables = allItems.reduce((s, item) => s + countTables(item.content), 0);
console.log(`Source  tables: ${srcTables}`);
console.log(`History tables: ${histTables}`);
console.log(`GFM tables: ${srcTables === histTables ? "PASS" : "MISMATCH"}`);
if (srcTables !== histTables) errors++;


// --- KaTeX Render Gate ---
console.log("");
console.log("=== KaTeX Render Gate ===");
let katexErrors = 0;
let katexFormulaCount = 0;
for (const item of allItems) {
  const { segments, textOutsideMath } = collectMathSegments(item.content);
  katexFormulaCount += segments.length;
  const strayDollar = textOutsideMath.match(/(?<!\\)\$/);
  if (strayDollar) {
    console.error(`KaTeX stray $: ${item.sourcePath}`);
    katexErrors++;
  }
  const residual = textOutsideMath.match(/\\(?:begin|end)\{[^}]*\}/);
  if (residual) {
    console.error(`KaTeX residual env: ${item.sourcePath}: "${residual[0]}"`);
    katexErrors++;
  }
  for (const seg of segments) {
    try {
      katex.renderToString(seg.source, { displayMode: seg.displayMode, throwOnError: true, strict: "ignore" });
    } catch (e) {
      if (e instanceof katex.ParseError) {
        console.error(`KaTeX parse error: ${item.sourcePath}: ${e.message.split("\n")[0]}`);
        katexErrors++;
      } else {
        throw e;
      }
    }
  }
}
console.log(`KaTeX render: ${katexErrors === 0 ? `PASS (${katexFormulaCount} formulas)` : `${katexErrors} error(s)`}`);
if (katexErrors > 0) errors += katexErrors;
// --- Final ---
console.log("");
if (errors > 0) {
  console.error(`${errors} error(s) total`);
  process.exit(1);
}

console.log(`OK all ${allItems.length} items verified (${srcPaths.length} source files)`);
process.exit(0);
