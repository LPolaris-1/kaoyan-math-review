// Comprehensive tests for data:build and data:verify pipeline.
// Uses temporary directories — never touches real history.json or real source files.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import {
  parseMarkdownFile, extractDate, clean, cleanTitle, titleFields, matchDate, localDate,
  parseList, groupByDate, classifyAdmission, summarizeAdmissions,
  hasQuestionEvidence, hasProcessEvidence
} from "../scripts/shared/data-lib.mjs";
import { normalizeMathDelimiters, collectMathSegments } from "../app/math-content.mjs";
import { findPlainMath } from "../scripts/shared/math-gate.mjs";
import katex from "katex";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-test-"));

// ========== gray-matter canonical body tests ==========

test("gray-matter: LF, no trailing newline after content", () => {
  const text = "---\ntitle: test\n---\n# Heading\nSome text";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "# Heading\nSome text");
  assert.strictEqual(parsed.data.title, "test");
});

test("gray-matter: LF, trailing newline", () => {
  const text = "---\ntitle: test\n---\n# Heading\nSome text\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "# Heading\nSome text\n");
});

test("gray-matter: LF, blank line after frontmatter", () => {
  const text = "---\ntitle: test\n---\n\n# Heading\nSome text\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "\n# Heading\nSome text\n");
});

test("gray-matter: LF, blank line after frontmatter + trailing blank line", () => {
  const text = "---\ntitle: test\n---\n\n# Heading\nSome text\n\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "\n# Heading\nSome text\n\n");
});

test("gray-matter: LF, multiple blank lines after frontmatter", () => {
  const text = "---\ntitle: test\n---\n\n\n\n# Heading\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "\n\n\n# Heading\n");
});

test("gray-matter: no frontmatter", () => {
  const text = "# Just a heading\nContent here\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "# Just a heading\nContent here\n");
  assert.deepStrictEqual(parsed.data, {});
});

test("gray-matter: empty frontmatter", () => {
  const text = "---\n---\n\n# Body\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "\n# Body\n");
  assert.deepStrictEqual(parsed.data, {});
});

// ========== CRLF tests ==========

test("gray-matter: CRLF, trailing newline", () => {
  const text = "---\r\ntitle: test\r\n---\r\n# Heading\r\nSome text\r\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "# Heading\r\nSome text\r\n");
});

test("gray-matter: CRLF, blank line after frontmatter, trailing blank line", () => {
  const text = "---\r\ntitle: test\r\n---\r\n\r\n# Heading\r\nSome text\r\n\r\n";
  const parsed = matter(text);
  assert.strictEqual(parsed.content, "\r\n# Heading\r\nSome text\r\n\r\n");
});

// ========== LaTeX delimiter preservation ==========

test("gray-matter: preserves $$ LaTeX", () => {
  const text = "---\ntitle: t\n---\n# Math\n$$\nA^T\n$$\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("$$\nA^T\n$$"));
});

test("gray-matter: preserves inline $ LaTeX", () => {
  const text = "---\ntitle: t\n---\n# Math\n$x^{2}$ stuff\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("$x^{2}$"));
});

test("gray-matter: preserves \\(...\\) LaTeX", () => {
  const text = "---\ntitle: t\n---\n# Math\n\\( a+b \\) text\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("\\( a+b \\)"));
});

test("gray-matter: preserves \\[...\\] LaTeX", () => {
  const text = "---\ntitle: t\n---\n# Math\n\\[\nA\n\\]\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("\\[\nA\n\\]"));
});

test("gray-matter: preserves matrix transpose $P^{T}$ and $A^{T}$", () => {
  const text = "---\ntitle: t\n---\n# LA\n$P^{T}$ and $A^{T}$\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("$P^{T}$"));
  assert.ok(parsed.content.includes("$A^{T}$"));
});

test("gray-matter: preserves inverse of transpose $(P^{T})^{-1}$", () => {
  const text = "---\ntitle: t\n---\n# LA\nThus $(P^{T})^{-1}$ and $(P^{-1})^{T}$.\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("$(P^{T})^{-1}$"));
  assert.ok(parsed.content.includes("$(P^{-1})^{T}$"));
});

// ========== GFM table ==========

test("gray-matter: preserves GFM table", () => {
  const text = "---\ntitle: t\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("| a | b |"));
  assert.ok(parsed.content.includes("|---|---|"));
  assert.ok(parsed.content.includes("| 1 | 2 |"));
});

// ========== backslash preservation ==========

test("gray-matter: preserves backslash escaping", () => {
  const text = "---\ntitle: t\n---\n# Note\n$\\alpha$ and $\\beta$\n";
  const parsed = matter(text);
  assert.ok(parsed.content.includes("$\\alpha$"));
  assert.ok(parsed.content.includes("$\\beta$"));
});

// ========== Date logic tests with stat injection ==========

test("extractDate: uses historicalDate when available", () => {
  const result = extractDate("/fake/test.md", "2025-01-15", null);
  assert.strictEqual(result, "2025-01-15");
});

test("extractDate: uses valid birthtime from injected stat", () => {
  const statFn = () => ({
    birthtime: new Date("2026-07-20T12:00:00Z"),
    mtime: new Date("2026-07-24T12:00:00Z"),
  });
  const result = extractDate("/fake/test.md", null, statFn);
  assert.strictEqual(result, "2026-07-20");
});

test("extractDate: falls back to mtime when birthtime is epoch", () => {
  const statFn = () => ({
    birthtime: new Date(0), // Unix epoch — invalid
    mtime: new Date("2026-07-20T12:00:00Z"),
  });
  const result = extractDate("/fake/test.md", null, statFn);
  assert.strictEqual(result, "2026-07-20");
});

test("extractDate: falls back to mtime when birthtime is NaN", () => {
  const statFn = () => ({
    birthtime: new Date("invalid"),
    mtime: new Date("2026-07-20T12:00:00Z"),
  });
  const result = extractDate("/fake/test.md", null, statFn);
  assert.strictEqual(result, "2026-07-20");
});

test("extractDate: historicalDate locks even if mtime changed (simulated)", () => {
  // New file detected on 2026-07-20, then re-run on 2026-07-24
  // First run: no historical -> uses birthtime 2026-07-20
  const statFn1 = () => ({ birthtime: new Date("2026-07-20T12:00:00Z") });
  const firstResult = extractDate("/fake/test.md", null, statFn1);
  assert.strictEqual(firstResult, "2026-07-20");

  // Second run: historicalDate locks it, ignoring mtime shift
  const statFn2 = () => ({
    birthtime: new Date("2026-07-20T12:00:00Z"),
    mtime: new Date("2026-07-24T12:00:00Z"),
  });
  const secondResult = extractDate("/fake/test.md", firstResult, statFn2);
  assert.strictEqual(secondResult, "2026-07-20");
});

test("extractDate: missed-day scenario uses locked historical date not today", () => {
  // File added on 2026-07-23. On 2026-07-23 we "missed" running.
  // On 2026-07-24 we run: historicalDate should lock to original registration
  const statFn = () => ({ birthtime: new Date("2026-07-23T12:00:00Z") });
  const result = extractDate("/fake/test.md", "2026-07-23", statFn);
  assert.strictEqual(result, "2026-07-23");
});

// ========== Utility tests ==========

test("clean: removes markdown formatting", () => {
  assert.strictEqual(clean("**bold** text"), "bold text");
  assert.strictEqual(clean("[link](url)"), "link");
  assert.strictEqual(clean("### heading"), "heading");
});

test("titleFields: preserves math syntax in titleMarkdown", () => {
  const body = "# 求极限 $\\lim_{n\\to\\infty} a_{n+1}$\n内容";
  const { titleMarkdown, title } = titleFields(body, "fallback.md");
  assert.strictEqual(titleMarkdown, "求极限 $\\lim_{n\\to\\infty} a_{n+1}$");
  assert.ok(titleMarkdown.includes("a_{n+1}"));
  assert.ok(titleMarkdown.includes("$\\lim_{n\\to\\infty} a_{n+1}$"));
  assert.strictEqual(title, titleMarkdown);
});

test("titleFields: plain text title keeps underscores", () => {
  const { title } = titleFields("# 数列 a_{n+1} 的收敛性\n正文", "");
  assert.strictEqual(title, "数列 a_{n+1} 的收敛性");
});

test("cleanTitle: keeps underscores and strips bold", () => {
  assert.strictEqual(cleanTitle("**求** a_{n+1}"), "求 a_{n+1}");
});

test("titleFields: falls back to provided fallback", () => {
  const { titleMarkdown, title } = titleFields("no heading", "默认标题");
  assert.strictEqual(titleMarkdown, "默认标题");
  assert.strictEqual(title, "默认标题");
});

test("localDate: formats correctly", () => {
  const d = new Date("2026-07-24T12:00:00Z");
  const result = localDate(d);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test("matchDate: extracts YYYY-MM-DD", () => {
  assert.strictEqual(matchDate("date: 2026-07-24 extra"), "2026-07-24");
  assert.strictEqual(matchDate("no date"), null);
});

test("parseList: handles array", () => {
  assert.deepStrictEqual(parseList(["a", "b"]), ["a", "b"]);
});

test("parseList: handles comma-separated string", () => {
  assert.deepStrictEqual(parseList("[a,b,c]"), ["a", "b", "c"]);
});

// ========== Wrong-question admission contract ==========

test("admission: explicit entry_type is authoritative", () => {
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/题型-知识.md", fields: { entry_type: "wrong_question" } }),
    { status: "include", reason: "entry_type: wrong_question" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/错题-旧.md", fields: { entry_type: "knowledge" } }),
    { status: "exclude", reason: "entry_type: knowledge" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/未知.md", fields: { entry_type: "summary" } }),
    { status: "ambiguous", reason: "unsupported entry_type: summary" }
  );
});

test("admission: legacy 方法/题型- naming exclusions stay deterministic", () => {
  assert.equal(classifyAdmission({ relativePath: "线代/题型-秩1.md", fields: {} }).status, "exclude");
  assert.equal(classifyAdmission({ relativePath: "线代/方法/特征根法.md", fields: {} }).status, "exclude");
  assert.equal(classifyAdmission({ relativePath: "线代/伴随矩阵的行列式推导.md", fields: {} }).status, "exclude");
  // The same paths stay excluded when the body lacks the full structure.
  const questionOnly = "## 题目\n已知 $f(x)=x^2$，求 $f'(x)$。\n";
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/方法/特征根法.md", fields: {}, body: questionOnly }),
    { status: "exclude", reason: "legacy 方法 directory" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/题型-秩1.md", fields: {}, body: questionOnly }),
    { status: "exclude", reason: "legacy 题型- basename" }
  );
});

test("admission: full 题目+过程 content wins over legacy naming", () => {
  const body = [
    "## 题目",
    "已知 $f(x)=x^2$，求 $f'(x)$。",
    "",
    "## 解答",
    "第一步：$f'(x)=2x$。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/方法/特征根法.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/题型-秩1.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/伴随矩阵的行列式推导.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
});

test("admission: 题目 + 详细步骤 include", () => {
  const body = [
    "## 题目",
    "已知 $f(x)=x^2$，求 $f'(x)$。",
    "",
    "## 解答",
    "第一步：$f'(x)=2x$。",
    "第二步：代入 $x=1$ 得 $f'(1)=2$。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/导数.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
});

test("admission: 问题 + 推导 include", () => {
  const body = [
    "## 问题",
    "设 $A$ 为 $n$ 阶方阵，证明 $|A^T|=|A|$。",
    "",
    "## 推导",
    "按行列式定义展开即可。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/转置.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
});

test("admission: 典型题 + 具体积分 + 过程 include", () => {
  const body = [
    "## 典型题",
    "计算 $\\int_0^1 x\\,dx$。",
    "",
    "## 解析",
    "原式 $=\\left[\\frac{x^2}{2}\\right]_0^1=\\frac{1}{2}$。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/定积分.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
});

test("admission: only formula derivation or example notes are excluded", () => {
  const formulaOnly = [
    "## 推导",
    "$F'(x)=f(x)$，故 $\\int f(x)\\,dx=F(x)+C$。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/notes-a.md", fields: {}, body: formulaOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
  const exampleOnly = [
    "## 示例",
    "例如 $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$，可作反例使用。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/notes-b.md", fields: {}, body: exampleOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
});

test("admission: 错题 filename/tag alone no longer admits method-only notes", () => {
  const methodOnly = [
    "## 方法",
    "遇到极限题先判断类型，再选择洛必达或等价无穷小。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/错题-极限.md", fields: {}, body: methodOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "高数/notes.md", fields: { tags: ["考研数学错题"] }, body: methodOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
});

test("admission: 错题 filename with complete content still includes", () => {
  const body = [
    "## 题目",
    "已知 $f(x)=x^2$，求 $f'(x)$。",
    "",
    "## 解答",
    "$f'(x)=2x$。",
  ].join("\n");
  assert.equal(
    classifyAdmission({ relativePath: "高数/错题-导数.md", fields: {}, body }).status,
    "include"
  );
});

test("admission: question only or process only is excluded", () => {
  const questionOnly = [
    "## 题目",
    "证明：设 $A$ 可逆，则 $A^T$ 可逆。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/notes-q.md", fields: {}, body: questionOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
  const processOnly = [
    "## 解答",
    "$f'(x)=2x$。",
  ].join("\n");
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/notes-p.md", fields: {}, body: processOnly }),
    { status: "exclude", reason: "missing concrete question or solution process" }
  );
});

test("admission: unknown legacy files fail closed via the content gate", () => {
  assert.equal(
    classifyAdmission({ relativePath: "高数/中值定理与辅助函数构造.md", fields: {} }).status,
    "exclude"
  );
});

test("admission evidence: question/process detection is structural", () => {
  assert.equal(hasQuestionEvidence("## 题目\n已知 $f(x)=x^2$，求 $f'(x)$。\n"), true);
  assert.equal(hasQuestionEvidence("# 题目\n已知 $f(x)=x^2$，求 $f'(x)$。\n"), false);
  assert.equal(hasQuestionEvidence("## 题型\n常见题型汇总\n"), false);
  assert.equal(hasQuestionEvidence("## 题型\n已知 $f(x)=x^2$，求 $f'(x)$。\n"), true);
  assert.equal(hasProcessEvidence("## 题目\n已知 $f(x)=x^2$。\n\n## 解答\n$f'(x)=2x$。\n"), true);
  assert.equal(hasProcessEvidence("## 题目\n证明：设 $A$ 可逆，则 $A^T$ 可逆。\n"), false);
  assert.equal(hasProcessEvidence("## 解答\n$f'(x)=2x$。\n"), false);
});

test("admission evidence: nested 证明 subtree counts as process evidence", () => {
  const body = [
    "## 题目",
    "证明：若 $A$ 可逆，则 $A^T$ 可逆。",
    "",
    "## 证明",
    "### 充分性",
    "由 $AA^{-1}=E$ 转置得 $(A^T)(A^{-1})^T=E$。",
    "",
    "### 必要性",
    "反向推导同样成立。",
  ].join("\n");
  assert.equal(hasProcessEvidence(body), true);
  assert.deepStrictEqual(
    classifyAdmission({ relativePath: "线代/题型-可逆.md", fields: {}, body }),
    { status: "include", reason: "content has concrete question and solution process" }
  );
});

test("admission evidence: headings-only subtree is not process evidence", () => {
  const body = [
    "## 题目",
    "已知 $f(x)=x^2$。",
    "",
    "## 解答",
    "### 第一步",
    "### 第二步",
  ].join("\n");
  assert.equal(hasProcessEvidence(body), false);
  assert.equal(
    classifyAdmission({ relativePath: "高数/错题-空解答.md", fields: {}, body }).status,
    "exclude"
  );
});

test("admission summary: preserves all classifications", () => {
  const summary = summarizeAdmissions([
    { admission: { status: "include" } },
    { admission: { status: "exclude" } },
    { admission: { status: "ambiguous" } },
  ]);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.length])), {
    include: 1, exclude: 1, ambiguous: 1,
  });
});

// ========== Grouping tests ==========

test("groupByDate: groups and sorts", () => {
  const notes = [
    { date: "2026-01-02", title: "b", subject: "高数", topic: "t1", keyPoints: [], pitfalls: [] },
    { date: "2026-01-01", title: "a", subject: "线代", topic: "t2", keyPoints: [], pitfalls: [] },
    { date: "2026-01-01", title: "c", subject: "线代", topic: "t2", keyPoints: [], pitfalls: [] },
  ];
  const days = groupByDate(notes);
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].date, "2026-01-02"); // newest first
  assert.strictEqual(days[0].count, 1);
  assert.strictEqual(days[1].date, "2026-01-01");
  assert.strictEqual(days[1].count, 2);
});

// ========== Integration: parseNote roundtrip ==========

test("integration: parseMarkdownFile preserves content byte-exact", () => {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "roundtrip-"));
  const f = path.join(tmpDir, "test.md");
  const bodyText = "\n# Title\n\nContent goes here\n\n$$A^{T}$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
  const text = `---\ntitle: Test\nsubject: 高数\ntags:\n  - math\n---\n${bodyText}`;
  fs.writeFileSync(f, text, "utf8");

  const { fields, body } = parseMarkdownFile(f);
  assert.strictEqual(body, bodyText);
  assert.strictEqual(fields.title, "Test");
  assert.strictEqual(fields.subject, "高数");
  assert.deepStrictEqual(fields.tags, ["math"]);
  assert.ok(body.includes("$$A^{T}$$"));
  assert.ok(body.includes("| a | b |"));
});

// ========== Cleanup ==========


// ========== normalizeMathDelimiters regression ==========

test("normalizeMathDelimiters: converts \\\\[...\\\\] to $$...$$", () => {
  const input = "\n\\[ x^2 + y^2 \\]\n";
  const result = normalizeMathDelimiters(input);
  assert.ok(result.includes("$$ x^2 + y^2 $$"));
  assert.ok(!result.includes("\\["));
  assert.ok(!result.includes("\\]"));
});

test("normalizeMathDelimiters: preserves \\\\\\\\[6pt] in array environments", () => {
  const input = "\n$$\\\\begin{array}{c} a \\\\\\\\ b \\\\\\\\[6pt] c \\\\end{array}$$\n";
  const result = normalizeMathDelimiters(input);
  assert.ok(result.includes("\\\\\\\\[6pt]"));
});

// ========== collectMathSegments regression ==========

test("collectMathSegments: extracts display and inline segments", () => {
  const input = "text $$ x^2 $$ more $y$ end";
  const { segments } = collectMathSegments(input);
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].displayMode, true);
  assert.strictEqual(segments[0].source, " x^2 ");
  assert.strictEqual(segments[1].displayMode, false);
  assert.strictEqual(segments[1].source, "y");
});

// ========== KaTeX render regression ==========

test("KaTeX: valid formula renders successfully", () => {
  const result = katex.renderToString("x^2 + y^2", { displayMode: true, throwOnError: true, strict: "ignore" });
  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
});

test("KaTeX: bad formula throws ParseError", () => {
  assert.throws(() => {
    katex.renderToString("\\\\badcommand{x", { displayMode: true, throwOnError: true, strict: "ignore" });
  }, (err) => {
    return err instanceof katex.ParseError;
  });
});

test("collectMathSegments: unclosed $ stays in textOutsideMath", () => {
  const input = "price $x unfinished";
  const { segments, textOutsideMath } = collectMathSegments(input);
  assert.strictEqual(segments.length, 0);
  assert.ok(textOutsideMath.includes("$x"));
});

// ========== strict plain-math import gate ==========

test("LaTeX gate: accepts delimited formula", () => {
  const issues = findPlainMath("L = $\\lim_{n\\to\\infty} \\sqrt[n]{n}$", "valid.md");
  assert.deepStrictEqual(issues, []);
});

test("LaTeX gate: rejects slash division inside inline and display math", () => {
  const issues = findPlainMath("inline $a/b$\n$$x/(1+x)$$", "slash.md");
  assert.strictEqual(issues.length, 2);
  assert.deepStrictEqual(issues.map((issue) => issue.lineNumber), [1, 2]);
  assert.ok(issues.every((issue) => issue.signals.includes("斜杠除法")));
  assert.ok(issues.every((issue) => issue.message.includes("\\frac{分子}{分母}")));
});

test("LaTeX gate: accepts fraction commands and ordinary prose slashes", () => {
  const body = "公式 $\\frac{a}{b}$\nhttps://example.com/a/b\n方法 A/B";
  assert.deepStrictEqual(findPlainMath(body, "fraction.md"), []);
});

test("LaTeX gate: rejects Unicode/plain formula with location and conversion hint", () => {
  const body = "求极限：\nL = lim[n→∞] (ⁿ√∏[k=1→n] (k²+n²) ) / (1+2+…+n)\n";
  const issues = findPlainMath(body, "bad.md");
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].lineNumber, 2);
  assert.match(issues[0].snippet, /lim\[n→∞\]/u);
  assert.match(issues[0].message, /LaTeX/);
});

test("LaTeX gate: accepts multiline bracket-delimited formula", () => {
  const body = "\\[\n\\sum_{k=1}^{n} k\n\\]\n";
  assert.deepStrictEqual(findPlainMath(body, "multiline.md"), []);
});

test("LaTeX gate: ignores fenced code blocks but detects plain paragraphs", () => {
  const body = "```js\nconst L = lim[n→∞] (k²+n²)\nconst x = a/b;\n```\n普通段落 lim[n→∞] 未包裹";
  const issues = findPlainMath(body, "code.md");
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].lineNumber, 5);
  assert.match(issues[0].snippet, /lim\[n→∞\]/u);
});

test("LaTeX gate: ignores inline code but detects plain paragraphs", () => {
  const body = "用 `lim[n→∞]` 表示；真正公式 lim[n→∞] 未包裹";
  const issues = findPlainMath(body, "inline.md");
  assert.strictEqual(issues.length, 1);
  assert.match(issues[0].snippet, /lim\[n→∞\]/u);
});

test("LaTeX gate: ignores slash division inside code blocks", () => {
  const body = "```python\nratio = a/b\n```\n$ok$";
  assert.deepStrictEqual(findPlainMath(body, "code-slash.md"), []);
});


test("strayDollar regex: escaped \$ is NOT detected as stray", () => {
  const strayDollarPattern = /(?<!\\)\$/;
  assert.strictEqual(strayDollarPattern.test("price \\$5 normal"), false);
  // but a bare $ without backslash SHOULD match
  assert.strictEqual(strayDollarPattern.test("price $x unfinished"), true);
});
test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
