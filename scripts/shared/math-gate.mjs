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

function maskMath(value) {
  const normalized = normalizeMathDelimiters(String(value));
  return normalized.replace(MATH_BLOCK, (segment) => segment.replace(/[^\r\n]/g, " "));
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

  return issues;
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
