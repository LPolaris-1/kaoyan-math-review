"use client";

import { useEffect, useState } from "react";
import { loadHistoryDay } from "../../lib/history-loader.mjs";
import { MarkdownContent } from "./markdown-content";

type HistoryDay = {
  date: string;
  items: Array<{ id: string; content: string }>;
};

export function LazyHistoryContent({
  date,
  itemId,
  sourcePath,
  summary = "查看原档案题目与完整推导",
}: {
  date: string;
  itemId: string;
  sourcePath: string;
  summary?: string;
}) {
  const [hasOpened, setHasOpened] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hasOpened || content !== null) return;
    let active = true;
    loadHistoryDay(date)
      .then((day: HistoryDay) => {
        const item = day.items.find((entry: { id: string; content: string }) => entry.id === itemId);
        if (!item) throw new Error("当日错题详情不完整，请刷新后重试。");
        if (active) setContent(item.content);
      })
      .catch((caught: Error) => {
        if (active) setError(caught.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [attempt, content, date, hasOpened, itemId]);

  return (
    <details onToggle={(event) => {
      if (event.currentTarget.open && !hasOpened) {
        setLoading(true);
        setHasOpened(true);
      }
    }}>
      <summary>{summary}</summary>
      {hasOpened && <div className="detail-content">
        {loading && <p className="source-note detail-loading" role="status">正在加载当日题目…</p>}
        {error && <div className="progress-alert detail-error" role="alert">
          {error} <button type="button" onClick={() => {
            setError("");
            setLoading(true);
            setAttempt((current) => current + 1);
          }}>重试</button>
        </div>}
        {content !== null && <>
          <MarkdownContent value={content} />
          <p className="source-note">来源：{sourcePath}</p>
        </>}
      </div>}
    </details>
  );
}
