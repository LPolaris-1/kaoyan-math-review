"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { normalizeMathDelimiters } from "../math-content.mjs";

export function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="original-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeMathDelimiters(value)}
      </ReactMarkdown>
    </div>
  );
}
