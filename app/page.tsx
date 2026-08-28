"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MarkdownContent } from "./components/markdown-content";
import { InlineMathMarkdown } from "./components/inline-math-markdown";

type ReviewItem = {
  id: string;
  title: string;
  titleMarkdown?: string;
  subject: string;
  chapter: string;
  topic: string;
  methods: string[];
  question: string;
  keyPoints: string[];
  pitfalls: string[];
  answer: string;
  content: string;
  sourcePath: string;
};

type ReviewDay = {
  date: string;
  count: number;
  subjectCounts: Record<string, number>;
  topics: string[];
  takeaways: string[];
  summary: string;
  items: ReviewItem[];
};

type HistoryData = {
  generatedAt: string;
  totalNotes: number;
  totalDays: number;
  days: ReviewDay[];
};

type ReviewProgress = {
  itemId: string;
  masteryLevel: number;
  examFrequency: "high" | "medium" | "low" | "unknown";
  reviewStage: number;
  nextReviewDate: string;
  mastered: boolean;
  lastReviewedAt: string | null;
  lastResult: string | null;
  updatedAt: string | null;
};

const subjectOptions = ["全部", "高数", "线代"];

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}月${day}日`;
}

function formatGeneratedAt(value: string) {
  if (!value) return "等待首次扫描";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}


export default function Home() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [subject, setSubject] = useState("全部");
  const [query, setQuery] = useState("");
  const [progressById, setProgressById] = useState<Record<string, ReviewProgress>>({});
  const [progressError, setProgressError] = useState("");
  const [savingId, setSavingId] = useState("");

  useEffect(() => {
    fetch("/data/history.json")
      .then((response) => response.json())
      .then((history: HistoryData) => {
        setData(history);
        setSelectedDate(history.days[0]?.date || "");
      })
      .catch(() => setData({ generatedAt: "", totalNotes: 0, totalDays: 0, days: [] }));
    fetch("/api/review-progress")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "复习进度暂不可用");
        return body as { progress: ReviewProgress[] };
      })
      .then(({ progress }) => {
        setProgressById(Object.fromEntries(progress.map((row) => [row.itemId, row])));
        setProgressError("");
      })
      .catch((error: Error) => setProgressError(error.message));
  }, []);

  const currentDay = data?.days.find((day) => day.date === selectedDate) || null;
  const filteredItems = useMemo(() => currentDay?.items.filter((item) => {
    const matchesSubject = subject === "全部" || item.subject === subject;
    const text = `${item.title} ${item.topic} ${item.chapter} ${item.methods.join(" ")}`.toLowerCase();
    return !progressById[item.id]?.mastered && matchesSubject && (!query || text.includes(query.toLowerCase()));
  }) || [], [currentDay, progressById, query, subject]);

  async function setMastered(itemId: string, mastered: boolean) {
    setSavingId(itemId);
    try {
      const response = await fetch("/api/review-progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mastered ? "master" : "unmaster", itemId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      setProgressById((current) => ({ ...current, [itemId]: body.progress }));
      setProgressError("");
    } catch (error) {
      setProgressError(error instanceof Error ? error.message : "保存复习进度失败");
    } finally {
      setSavingId("");
    }
  }

  if (!data) return <main className="loading-shell"><div className="loading-card">正在加载错题复盘…</div></main>;

  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand-mark">M²</div>
        <div><p className="brand-name">考研数学 · 错题复盘</p><p className="brand-subtitle">把错题，变成会做的题</p></div>
        <Link className="review-entry" href="/review">滚动复习 <span>→</span></Link>
        <div className="sync-status"><span className="status-dot" /> 每天 22:00 自动更新</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DAILY REVIEW / 每日复盘</p>
          <h1>{currentDay ? `${formatDate(currentDay.date)}，复盘开始。` : "还没有可复盘的错题"}</h1>
          <p className="hero-copy">按日期留住每一次失分，把“我会了”变成可重复的解题路径。</p>
        </div>
        <div className="hero-note"><span>最近扫描</span><strong>{formatGeneratedAt(data.generatedAt)}</strong><small>{data.totalNotes} 道题 · {data.totalDays} 个复盘日</small></div>
      </section>

      {progressError && <div className="progress-alert">{progressError} 历史错题仍可正常浏览。</div>}

      <section className="date-strip" aria-label="复盘日期">
        {data.days.slice(0, 14).map((day) => (
          <button key={day.date} className={`date-chip ${day.date === selectedDate ? "is-active" : ""}`} onClick={() => setSelectedDate(day.date)}>
            <span>{formatDate(day.date)}</span><b>{day.count}</b>
          </button>
        ))}
        {!data.days.length && <div className="empty-date">扫描完成后，这里会出现每天的错题记录。</div>}
      </section>

      {currentDay && <>
        <section className="stat-grid">
          <div className="stat-card stat-card-accent"><span>今日错题</span><strong>{currentDay.count}</strong><small>道</small></div>
          <div className="stat-card"><span>覆盖学科</span><strong>{Object.keys(currentDay.subjectCounts).length}</strong><small>个</small></div>
          <div className="stat-card"><span>重点主题</span><strong>{currentDay.topics.length}</strong><small>组</small></div>
          <div className="stat-card stat-card-note"><span>今日提醒</span><strong>{currentDay.takeaways[0] || "先复盘，再刷题"}</strong></div>
        </section>

        <section className="review-layout">
          <aside className="overview-card">
            <div className="section-kicker">TODAY / 今日概览</div>
            <h2>{currentDay.summary}</h2>
            <p>先看下面的高频主题，再逐题展开。复盘时重点回答：我错在概念、方法，还是计算路径？</p>
            <div className="topic-list">{currentDay.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
            <div className="subject-breakdown">{Object.entries(currentDay.subjectCounts).map(([name, count]) => <div key={name}><span>{name}</span><strong>{count}</strong></div>)}</div>
          </aside>

          <div className="question-column">
            <div className="toolbar"><div className="filters">{subjectOptions.map((option) => <button key={option} className={subject === option ? "filter-active" : ""} onClick={() => setSubject(option)}>{option}</button>)}</div><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、主题或方法" /></label></div>
            <div className="question-list">
              {filteredItems.map((item, index) => <HistoryQuestionCard
                key={item.id}
                item={item}
                index={index}
                mastered={Boolean(progressById[item.id]?.mastered)}
                saving={savingId === item.id}
                disabled={Boolean(progressError)}
                onSetMastered={setMastered}
              />)}
              {!filteredItems.length && <div className="empty-card">没有匹配的错题。换个筛选条件试试。</div>}
            </div>
          </div>
        </section>
      </>}

      <footer><span>复盘不是重复看答案，而是重新走一遍思路。</span><span>数据来自错题本原档案 · {formatGeneratedAt(data.generatedAt)} 更新</span></footer>
    </main>
  );
}

function HistoryQuestionCard({
  item,
  index,
  mastered,
  saving,
  disabled,
  onSetMastered,
}: {
  item: ReviewItem;
  index: number;
  mastered: boolean;
  saving: boolean;
  disabled: boolean;
  onSetMastered: (itemId: string, mastered: boolean) => void;
}) {
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <article className="question-card">
      <div className="question-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="question-main">
        <div className="question-heading">
          <div className="question-meta"><span className="subject-pill">{item.subject}</span>{item.chapter && <span>{item.chapter}</span>}</div>
          <label className="master-checkbox">
            <input
              type="checkbox"
              checked={mastered}
              disabled={saving || disabled}
              onChange={(event) => onSetMastered(item.id, event.target.checked)}
            />
            <span>{saving ? "保存中…" : "已掌握"}</span>
          </label>
        </div>
        <h3><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></h3>
        {item.topic && <p className="question-topic">{item.topic}</p>}
        <div className="method-row">{item.methods.slice(0, 4).map((method) => <span key={method}>{method}</span>)}</div>
        <details onToggle={(event) => {
          if (event.currentTarget.open) setHasOpened(true);
        }}>
          <summary>查看原档案题目与完整推导</summary>
          {hasOpened && <div className="detail-content"><MarkdownContent value={item.content} /><p className="source-note">来源：{item.sourcePath}</p></div>}
        </details>
      </div>
    </article>
  );
}
