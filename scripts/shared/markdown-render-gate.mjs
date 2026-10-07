import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "../../app/math-content.mjs";

const KATEX_ERROR_PATTERN = /<span class="katex-error" title="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;
const TAG_PATTERN = /\\tag\{([^}]*)\}/g;
const DISPLAY_BLOCK_PATTERN = /(?:^|\r?\n)[ \t]*\$\$[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*\$\$[ \t]*(?=\r?\n|$)/g;

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function findMathRenderIssues(value) {
  const normalized = normalizeMathDelimiters(value);
  const displayRanges = [...normalized.matchAll(DISPLAY_BLOCK_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const issues = [];

  for (const match of normalized.matchAll(TAG_PATTERN)) {
    const label = match[1];
    if (!/^\d+$/.test(label)) {
      issues.push({ type: "tag-label", source: match[0], message: "公式编号只允许纯数字，例如 \\tag{1}。" });
    }
    if (!displayRanges.some((range) => match.index >= range.start && match.index < range.end)) {
      issues.push({ type: "tag-display", source: match[0], message: "\\tag{} 只能位于起止 $$ 分别独占一行的块级公式中。" });
    }
  }

  const html = renderToStaticMarkup(React.createElement(
    ReactMarkdown,
    { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] },
    normalized,
  ));
  for (const match of html.matchAll(KATEX_ERROR_PATTERN)) {
    issues.push({
      type: "katex-render",
      source: decodeHtml(match[2]),
      message: decodeHtml(match[1]),
    });
  }

  return issues;
}
