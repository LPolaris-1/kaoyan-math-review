"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { normalizeMathDelimiters } from "../math-content.mjs";

type InlineMathMarkdownProps = {
  value: string;
  className?: string;
};

export const InlineMathMarkdown = memo(function InlineMathMarkdown({
  value,
  className = "inline-math-markdown",
}: InlineMathMarkdownProps) {
  return (
    <span className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        disallowedElements={["p"]}
        unwrapDisallowed
      >
        {normalizeMathDelimiters(value)}
      </ReactMarkdown>
    </span>
  );
});
