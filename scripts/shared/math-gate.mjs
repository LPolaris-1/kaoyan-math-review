import { normalizeMathDelimiters } from "../../app/math-content.mjs";

const MATH_BLOCK = /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])*\$/g;

const DETECTORS = [
  { label: "极限记号", pattern: /\blim\s*(?:\[|\(|\{|[A-Za-z]\s*(?:→|->)|n\s*(?:→|->))/iu },
  { label: "根号/求和/求积/积分", pattern: /[√∑∏∫]/u },
  { label: "无穷或数学关系符号", pattern: /[∞≤≥≠≈∈∂∇±]/u },
  { label: "Unicode 上标或根式", pattern: /[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+(?:√|[A-Za-z])/u },
  { label: "常见函数记号", pattern: /\b(?:sin|cos|tan|ln|log)\s*[A-Za-z0-9(]/iu },
  { label: "纯文本幂/下标", pattern: /[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{[^}\n]+\}|[A-Za-z0-9])/u },
];

const FENCED_CODE = /(?:^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?[ \t]{0,3}\1[ \t]*(?=\r?\n|$)/g;
const INLINE_CODE = /`[^`\r\n]*`/g;

/**
 * Replace fenced code blocks and inline code spans with spaces,
 * preserving newlines so line numbers stay aligned with the source.
 */
function maskCode(value) {
  return value
    .replace(FENCED_CODE, (segment) => segment.replace(/[^\r\n]/g, " "))
    .replace(INLINE_CODE, (segment) => segment.replace(/[^\r\n]/g, " "));
}

function maskMath(value) {
  const normalized = normalizeMathDelimiters(maskCode(String(value)));
  return normalized.replace(MATH_BLOCK, (segment) => segment.replace(/[^\r\n]/g, " "));
}

export function findSlashMath(body, filePath = "") {
  const source = String(body);
  const normalized = normalizeMathDelimiters(maskCode(source));
  const sourceLines = source.split(/\r?\n/);
  const issues = [];
  const seenLines = new Set();

  for (const match of normalized.matchAll(MATH_BLOCK)) {
    const segment = match[0];
    for (let index = segment.indexOf("/"); index >= 0; index = segment.indexOf("/", index + 1)) {
      const absoluteIndex = (match.index || 0) + index;
      const lineNumber = normalized.slice(0, absoluteIndex).split(/\r?\n/).length;
      if (seenLines.has(lineNumber)) continue;
      seenLines.add(lineNumber);
      issues.push({
        filePath,
        lineNumber,
        snippet: (sourceLines[lineNumber - 1] || "").trim().slice(0, 240),
        signals: ["斜杠除法"],
        message: "数学除法禁止使用 /，请改为 LaTeX 分式 \\frac{分子}{分母}。",
      });
    }
  }

  return issues;
}

export function findPlainMath(body, filePath = "") {
  const masked = maskMath(body);
  const issues = [];

  masked.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = String(body).split(/\r?\n/)[index] || "";
    if (!sourceLine.trim()) return;

    const signals = DETECTORS.filter(({ pattern }) => pattern.test(line)).map(({ label }) => label);
    if (signals.length === 0) return;

    issues.push({
      filePath,
      lineNumber: index + 1,
      snippet: sourceLine.trim().slice(0, 240),
      signals,
      message: "请将该数学表达式转换为 LaTeX，并使用 $...$ 或 $$...$$ 包裹。",
    });
  });

  return issues.concat(findSlashMath(body, filePath));
}

export function scanLatexGate(entries) {
  return entries.flatMap(({ filePath, body }) => findPlainMath(body, filePath));
}

export function formatLatexGateIssue(issue) {
  const location = `${issue.filePath}:${issue.lineNumber}`;
  return `LaTeX gate: ${location}\n  ${issue.snippet}\n  检测到：${issue.signals.join("、")}。${issue.message}`;
}

export function reportLatexGate(issues) {
  if (issues.length === 0) return true;
  console.error(`LaTeX import gate failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(formatLatexGateIssue(issue));
  return false;
}
