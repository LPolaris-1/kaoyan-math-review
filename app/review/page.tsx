"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MarkdownContent } from "../components/markdown-content";
import { InlineMathMarkdown } from "../components/inline-math-markdown";
import { ProgressOverview } from "../components/review/progress-overview";
import { ReviewOverview } from "../components/review/review-overview";
import {
  buildDailyQueue,
  buildTodayProgress,
  normalizeProgress,
  quadrantFor,
  shanghaiToday,
} from "../../lib/review-schedule.mjs";
import { parseReviewQuery, serializeReviewQuery } from "../../lib/review-navigation.mjs";

type ReviewItem = {
  id: string;
  date: string;
  title: string;
  titleMarkdown?: string;
  subject: string;
  chapter: string;
  topic: string;
  methods: string[];
  keyPoints: string[];
  pitfalls: string[];
  content: string;
  sourcePath: string;
  isPastExam: boolean;
};

type HistoryData = {
  generatedAt: string;
  totalNotes: number;
  days: Array<{ date: string; items: ReviewItem[] }>;
};

type PastExamDay = {
  date: string;
  count: number;
  subjectCounts: Record<string, number>;
  topics: string[];
  takeaways: string[];
  summary: string;
  items: ReviewItem[];
};

type Progress = {
  itemId: string;
  masteryLevel: number;
  examFrequency: "high" | "medium" | "low" | "unknown";
  reviewStage: number;
  nextReviewDate: string;
  mastered: boolean;
  lastReviewedAt: string | null;
  lastResult: string | null;
  updatedAt: string | null;
  cycleStartedAt: string | null;
};

type Tab = "today" | "progress" | "overview" | "matrix" | "mastered" | "pastExam";
type ReviewQuery = {
  view: Tab;
  range: 7 | 30 | 60;
  quadrants: string[];
  date: string | null;
  itemId: string | null;
  focus: "due" | "overdue" | "unstarted" | null;
};
type QueueEntry = {
  item: ReviewItem;
  progress: Progress;
  reason: string;
  source: string;
};
type ReviewEvent = {
  itemId: string;
  eventType: string;
  result?: string | null;
  occurredDate: string;
  scheduledDate?: string | null;
  reviewStageBefore?: number | null;
};

const frequencyLabels = {
  high: "高频",
  medium: "中频",
  low: "低频",
  unknown: "考频待定",
};

const matrixMeta = {
  blind: { title: "第一象限 · 核心盲区", caption: "未掌握 × 高频", className: "matrix-blind" },
  potential: { title: "第二象限 · 提分潜力", caption: "未掌握 × 低频", className: "matrix-potential" },
  consolidation: { title: "第三象限 · 巩固区", caption: "已掌握 × 高频", className: "matrix-consolidation" },
  safe: { title: "第四象限 · 安全区", caption: "已掌握 × 低频", className: "matrix-safe" },
};

const subjectOptions = ["全部", "高数", "线代"];

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}月${day}日`;
}

/**
 * Re-derive the 真题 day groups from the original 录入日期 grouping: keep only
 * isPastExam items and recompute count/subjectCounts/topics/takeaways/summary
 * for that subset. 真题 no longer lives on the home page; /review owns it and
 * only shows dates that actually contain past exam items.
 */
function derivePastExamDays(days: Array<{ date: string; items: ReviewItem[] }>): PastExamDay[] {
  return days.flatMap((day) => {
    const items = day.items.filter((item) => item.isPastExam);
    if (!items.length) return [];
    const subjectCounts = items.reduce<Record<string, number>>((counts, item) => {
      counts[item.subject] = (counts[item.subject] || 0) + 1;
      return counts;
    }, {});
    const topics = [...new Set(items.map((item) => item.topic).filter(Boolean))].slice(0, 6);
    const takeaways = [...new Set(items.flatMap((item) => [...item.keyPoints, ...item.pitfalls]))].slice(0, 6);
    return [{
      date: day.date,
      count: items.length,
      subjectCounts,
      topics,
      takeaways,
      summary: `${items.length} 道真题 · ${Object.entries(subjectCounts).map(([name, count]) => `${name} ${count} 道`).join("、")}`,
      items,
    }];
  });
}

export default function RollingReviewPage() {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [progressById, setProgressById] = useState<Record<string, Progress>>({});
  const [query, setQuery] = useState<ReviewQuery>(() => parseReviewQuery(typeof window === "undefined" ? "" : window.location.search));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState("");
  const [todayEvents, setTodayEvents] = useState<ReviewEvent[]>([]);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [initialTodayQueueIds, setInitialTodayQueueIds] = useState<string[] | null>(null);
  const [examDate, setExamDate] = useState("");
  const [examSubject, setExamSubject] = useState("全部");
  const [examQuery, setExamQuery] = useState("");
  const tab = query.view as Tab;
  const manualReviewId = query.view === "today" ? query.itemId : null;
  const [today, setToday] = useState(() => shanghaiToday());

  useEffect(() => {
    fetch("/data/history.json", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: HistoryData) => {
        setHistory(data);
        setExamDate((current) => current || derivePastExamDays(data.days)[0]?.date || "");
      })
      .catch(() => setError("错题历史加载失败，请稍后重试。"));

    fetch("/api/review-progress")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "复习进度暂不可用");
        return body as { progress: Progress[] };
      })
      .then(({ progress }) => {
        setProgressById(Object.fromEntries(progress.map((row) => [row.itemId, row])));
        setProgressLoaded(true);
        setError("");
      })
      .catch((caught: Error) => setError(caught.message));

  }, []);

  useEffect(() => {
    fetch(`/api/review-events?date=${encodeURIComponent(today)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "复习历史暂不可用");
        return body as { events: ReviewEvent[] };
      })
      .then(({ events }) => setTodayEvents(events))
      .catch((caught: Error) => setError(caught.message));
  }, [today]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday((current) => {
        const next = shanghaiToday();
        if (next !== current) {
          setInitialTodayQueueIds(null);
          setTodayEvents([]);
          return next;
        }
        return current;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onPopState = () => setQuery(parseReviewQuery(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigateTo(patch: Partial<ReviewQuery>, replace = false) {
    const next = { ...query, ...patch };
    const search = serializeReviewQuery(next);
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setQuery(next);
  }

  function navigateTab(view: Tab) {
    navigateTo({
      view,
      itemId: null,
      focus: null,
      date: view === "overview" ? query.date : null,
      quadrants: view === "overview" ? query.quadrants : [],
    });
  }

  function openManualReview(itemId: string) {
    navigateTo({ view: "today", itemId, focus: null, date: null, quadrants: [] });
  }

  const allItems = useMemo(() => {
    const unique = new Map<string, ReviewItem>();
    history?.days.forEach((day) => day.items.forEach((item) => unique.set(item.id, item)));
    return Array.from(unique.values());
  }, [history]);

  const entries = useMemo(
    () => allItems.map((item) => ({
      item,
      progress: normalizeProgress(progressById[item.id], item.id, today) as Progress,
    })),
    [allItems, progressById, today],
  );
  const reviewedTodayIds = useMemo(
    () => new Set(
      todayEvents
        .filter((event) =>
          (event.eventType === "review" && ["correct", "hard", "wrong"].includes(event.result ?? "")) ||
          event.eventType === "master"
        )
        .map((event) => event.itemId)
    ),
    [todayEvents],
  );
  const queue = useMemo(
    () => buildDailyQueue(allItems, progressById, today, reviewedTodayIds) as QueueEntry[],
    [allItems, progressById, today, reviewedTodayIds],
  );
  useEffect(() => {
    if (!history || !progressLoaded || initialTodayQueueIds !== null) return;
    const timer = window.setTimeout(() => setInitialTodayQueueIds(queue.map(({ item }) => item.id)), 0);
    return () => window.clearTimeout(timer);
  }, [history, progressLoaded, queue, initialTodayQueueIds]);
  const todayProgress = useMemo(
    () => buildTodayProgress(queue, todayEvents, today, initialTodayQueueIds ?? undefined),
    [queue, todayEvents, today, initialTodayQueueIds],
  );
  const manualQueue = useMemo(() => {
    if (!manualReviewId) return null;
    const entry = entries.find(({ item, progress }) => item.id === manualReviewId && !progress.mastered && Boolean(progress.cycleStartedAt));
    return entry ? [{ ...entry, reason: "手动提前复习：现在打开这道题，提交结果后仍由统一调度规则处理。", source: "manual" }] : null;
  }, [entries, manualReviewId]);
  const displayQueue = manualQueue ?? queue;
  const masteredEntries = entries.filter(({ progress }) => progress.mastered);
  const quadrants = useMemo(() => {
    const result: Record<string, typeof entries> = {
      blind: [],
      potential: [],
      consolidation: [],
      safe: [],
      medium: [],
      unknown: [],
    };
    entries.forEach((entry) => result[quadrantFor(entry.progress)].push(entry));
    return result;
  }, [entries]);
  const pastExamDays = useMemo(() => (history ? derivePastExamDays(history.days) : []), [history]);
  const pastExamTotal = useMemo(
    () => (history ? history.days.reduce((sum, day) => sum + day.items.filter((item) => item.isPastExam).length, 0) : 0),
    [history],
  );
  const pastExamDay = pastExamDays.find((day) => day.date === examDate) || pastExamDays[0] || null;
  const pastExamItems = useMemo(() => pastExamDay?.items.filter((item) => {
    const matchesSubject = examSubject === "全部" || item.subject === examSubject;
    const text = `${item.title} ${item.topic} ${item.chapter} ${item.methods.join(" ")}`.toLowerCase();
    return !progressById[item.id]?.mastered && matchesSubject && (!examQuery || text.includes(examQuery.toLowerCase()));
  }) || [], [pastExamDay, progressById, examSubject, examQuery]);

  async function updateProgress(itemId: string, payload: Record<string, string>) {
    setSavingId(itemId);
    setNotice("");
    try {
      const response = await fetch("/api/review-progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      setProgressById((current) => ({ ...current, [itemId]: body.progress }));
      if (payload.action === "review" || payload.action === "master") {
        setTodayEvents((current) => [
          ...current,
          {
            itemId,
            eventType: payload.action === "master" ? "master" : "review",
            result: payload.result ?? null,
            occurredDate: today,
            scheduledDate: progressById[itemId]?.nextReviewDate ?? today,
            reviewStageBefore: progressById[itemId]?.reviewStage ?? 0,
          },
        ]);
      }
      if (manualReviewId === itemId) {
        navigateTo({ itemId: null }, true);
      }
      setError("");
      if (payload.action === "review") {
        setNotice(
          payload.result === "correct"
            ? "已记录：掌握度上升，并安排下一个记忆节点。"
            : "已记录：这道题明天会再次出现。",
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存复习进度失败");
    } finally {
      setSavingId("");
    }
  }

  if (!history) {
    return <main className="loading-shell"><div className="loading-card">正在生成今日滚动复习…</div></main>;
  }

  return (
    <main className="site-shell review-page">
      <header className="topbar">
        <Link className="brand-mark brand-link" href="/" aria-label="返回错题复盘首页">M²</Link>
        <div><p className="brand-name">考研数学 · 滚动复习</p><p className="brand-subtitle">四象限 × 艾宾浩斯记忆曲线</p></div>
        <Link className="review-entry" href="/">历史错题 <span>→</span></Link>
      </header>

      <section className="review-hero">
        <div>
          <p className="eyebrow">ADAPTIVE REVIEW / 动态复习</p>
          <h1>今天只复习<br />最值得复习的题。</h1>
          <p>系统优先安排核心盲区和到期题，再补充少量低频随机挑战。</p>
        </div>
        <div className="review-score-panel">
          <div className="review-score">
            <span>今日队列</span>
            <strong>{queue.length}</strong>
            <small>未复习 {entries.filter(({ progress }) => !progress.mastered).length} · 已掌握 {masteredEntries.length}</small>
          </div>
          <TodayProgress progress={todayProgress} />
        </div>
      </section>

      {error && <div className="progress-alert">{error} 页面不会修改任何错题原档案。</div>}
      {notice && <div className="progress-notice">{notice}</div>}

      <nav className="review-tabs" aria-label="滚动复习分类">
        <button className={tab === "today" ? "is-active" : ""} onClick={() => navigateTab("today")}>今日复习 <b>{queue.length}</b></button>
        <button className={tab === "progress" ? "is-active" : ""} onClick={() => navigateTab("progress")}>全部进度 <b>{entries.length}</b></button>
        <button className={tab === "overview" ? "is-active" : ""} onClick={() => navigateTab("overview")}>复习总览</button>
        <button className={tab === "matrix" ? "is-active" : ""} onClick={() => navigateTab("matrix")}>四象限总览</button>
        <button className={tab === "mastered" ? "is-active" : ""} onClick={() => navigateTab("mastered")}>已掌握题库 <b>{masteredEntries.length}</b></button>
        <button className={tab === "pastExam" ? "is-active" : ""} onClick={() => navigateTab("pastExam")}>真题 <b>{pastExamTotal}</b></button>
      </nav>

      {tab === "today" && (
        <section className="rolling-section">
          <div className="section-heading">
            <div><p className="section-kicker">TODAY / 今日复习</p><h2>{queue.length ? "按优先级完成下面的题" : "今天的复习已经完成"}</h2></div>
            <p>“做错”会重启记忆链，“模糊”明天再见，“做对”会逐步延长到 30 天。</p>
          </div>
          <div className="rolling-list">
            {displayQueue.map(({ item, progress, reason, source }, index) => (
              <ReviewCard
                key={item.id}
                item={item}
                progress={progress}
                reason={reason}
                source={source}
                index={index}
                disabled={savingId === item.id}
                onAction={(payload) => updateProgress(item.id, payload)}
              />
            ))}
            {!displayQueue.length && <div className="empty-card success-empty">没有到期题目。已完成的题会按下一个记忆节点再次出现。</div>}
          </div>
        </section>
      )}

      {tab === "progress" && (
        <ProgressOverview
          entries={entries}
          today={today}
          savingId={savingId}
          onUpdate={updateProgress}
          focusItemId={query.itemId}
          focus={query.focus}
          onUpdateQuery={navigateTo}
          onReviewNow={openManualReview}
          onViewOverview={(itemId) => navigateTo({ view: "overview", itemId, focus: null })}
        />
      )}

      {tab === "overview" && (
        <ReviewOverview
          entries={entries}
          events={todayEvents}
          today={today}
          range={query.range}
          selectedDate={query.date}
          quadrants={query.quadrants}
          focusItemId={query.itemId}
          onUpdateQuery={navigateTo}
          onKpiNavigate={(focus) => navigateTo({ view: "progress", focus, itemId: null, date: null, quadrants: [] })}
          onViewProgress={(itemId) => navigateTo({ view: "progress", itemId, focus: null, date: null, quadrants: [] })}
          onReviewNow={openManualReview}
        />
      )}

      {tab === "matrix" && (
        <section className="rolling-section">
          <div className="section-heading">
            <div><p className="section-kicker">PRIORITY MATRIX / 四象限</p><h2>把时间投向最能提分的位置</h2></div>
            <p>考频必须由你确认；未标注题目不会被系统擅自判断。</p>
          </div>
          <div className="matrix-grid">
            {Object.entries(matrixMeta).map(([key, meta]) => (
              <article className={"matrix-card " + meta.className} key={key}>
                <span>{meta.caption}</span>
                <strong>{quadrants[key].length}</strong>
                <h3>{meta.title}</h3>
                <div className="matrix-items">
                  {quadrants[key].slice(0, 8).map(({ item }) => <p key={item.id}><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></p>)}
                  {!quadrants[key].length && <p className="muted-item">暂无题目</p>}
                </div>
              </article>
            ))}
          </div>
          <div className="unclassified-note">
            <strong>尚未进入四象限</strong>
            <span>中频 {quadrants.medium.length} 道 · 考频待定 {quadrants.unknown.length} 道</span>
          </div>
        </section>
      )}

      {tab === "mastered" && (
        <section className="rolling-section">
          <div className="section-heading">
            <div><p className="section-kicker">MASTERED / 已掌握</p><h2>已经退出滚动队列的错题</h2></div>
            <p>取消勾选后，这道题会在今天重新进入复习队列。</p>
          </div>
          <div className="mastered-grid">
            {masteredEntries.map(({ item, progress }) => (
              <article className="mastered-card" key={item.id}>
                <div><span>{item.subject} · {frequencyLabels[progress.examFrequency]}</span><h3><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></h3><p>{item.topic || item.chapter || "未标注考点"}</p></div>
                <label className="master-checkbox">
                  <input
                    type="checkbox"
                    checked
                    disabled={savingId === item.id || Boolean(error)}
                    onChange={() => updateProgress(item.id, { action: "unmaster" })}
                  />
                  <span>已掌握</span>
                </label>
              </article>
            ))}
            {!masteredEntries.length && <div className="empty-card">还没有勾选过的题目。</div>}
          </div>
        </section>
      )}

      {tab === "pastExam" && (
        <section className="rolling-section">
          <div className="section-heading">
            <div><p className="section-kicker">PAST EXAM / 真题</p><h2>{pastExamDay ? `${formatDate(pastExamDay.date)}，真题复盘。` : "还没有可复盘的真题"}</h2></div>
            <p>按原录入日期浏览真题；勾选“已掌握”的题会从真题列表隐藏，不影响今日滚动队列。</p>
          </div>

          <section className="date-strip" aria-label="真题日期">
            {pastExamDays.slice(0, 14).map((day) => (
              <button key={day.date} className={`date-chip ${day.date === pastExamDay?.date ? "is-active" : ""}`} onClick={() => setExamDate(day.date)}>
                <span>{formatDate(day.date)}</span><b>{day.count}</b>
              </button>
            ))}
            {!pastExamDays.length && <div className="empty-date">还没有标记为真题的错题。</div>}
          </section>

          {pastExamDay && <>
            <section className="stat-grid">
              <div className="stat-card stat-card-accent"><span>当日真题</span><strong>{pastExamDay.count}</strong><small>道</small></div>
              <div className="stat-card"><span>覆盖学科</span><strong>{Object.keys(pastExamDay.subjectCounts).length}</strong><small>个</small></div>
              <div className="stat-card"><span>重点主题</span><strong>{pastExamDay.topics.length}</strong><small>组</small></div>
              <div className="stat-card stat-card-note"><span>今日提醒</span><strong>{pastExamDay.takeaways[0] || "先复盘，再刷题"}</strong></div>
            </section>

            <section className="review-layout">
              <aside className="overview-card">
                <div className="section-kicker">PAST EXAM / 当日概览</div>
                <h2>{pastExamDay.summary}</h2>
                <p>先看下面的高频主题，再逐题展开。真题复盘重点回答：我错在概念、方法，还是计算路径？</p>
                <div className="topic-list">{pastExamDay.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
                <div className="subject-breakdown">{Object.entries(pastExamDay.subjectCounts).map(([name, count]) => <div key={name}><span>{name}</span><strong>{count}</strong></div>)}</div>
              </aside>

              <div className="question-column">
                <div className="toolbar"><div className="filters">{subjectOptions.map((option) => <button key={option} className={examSubject === option ? "filter-active" : ""} onClick={() => setExamSubject(option)}>{option}</button>)}</div><label className="search-box"><span>⌕</span><input value={examQuery} onChange={(event) => setExamQuery(event.target.value)} placeholder="搜索题目、主题或方法" /></label></div>
                <div className="question-list">
                  {pastExamItems.map((item, index) => <PastExamCard
                    key={item.id}
                    item={item}
                    index={index}
                    mastered={Boolean(progressById[item.id]?.mastered)}
                    saving={savingId === item.id}
                    disabled={Boolean(error)}
                    onSetMastered={(itemId, mastered) => updateProgress(itemId, { action: mastered ? "master" : "unmaster" })}
                  />)}
                  {!pastExamItems.length && <div className="empty-card">没有匹配的真题。换个筛选条件试试。</div>}
                </div>
              </div>
            </section>
          </>}
        </section>
      )}

      <footer><span>复习顺序由考频、掌握度和记忆节点共同决定。</span><span>勾选“已掌握”的题不会自动再次出现。</span></footer>
    </main>
  );
}

function TodayProgress({ progress }: { progress: ReturnType<typeof buildTodayProgress> }) {
  if (progress.total === 0) {
    return <div className="today-progress today-progress-empty">今日复习已完成</div>;
  }
  const percentage = Math.min(100, (progress.completed / progress.total) * 100);
  return (
    <div className="today-progress" aria-label={`今日复习进度 ${progress.completed} / ${progress.total}`}>
      <div className="today-progress-label"><strong>今日复习进度</strong><span>{progress.completed} / {progress.total}</span></div>
      <div className="today-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p>{progress.isComplete ? "今日复习已完成" : `今日已复习 ${progress.completed} 道 · 剩余 ${progress.remaining} 道`}</p>
    </div>
  );
}

function ReviewCard({
  item,
  progress,
  reason,
  source,
  index,
  disabled,
  onAction,
}: {
  item: ReviewItem;
  progress: Progress;
  reason: string;
  source: string;
  index: number;
  disabled: boolean;
  onAction: (payload: Record<string, string>) => void;
}) {
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <article className="rolling-card" id={`review-item-${encodeURIComponent(item.id)}`}>
      <div className="rolling-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="rolling-main">
        <div className="rolling-meta">
          <span className={"queue-source queue-" + source}>{source === "intake" ? "新错题 · 首次复习" : source === "core" ? "核心盲区" : source === "due" ? "到期复习" : source === "manual" ? "手动提前" : "随机挑战"}</span>
          <span>{item.subject}</span>
          <span>掌握度 {progress.masteryLevel}/5</span>
          <label className="frequency-select">
            考频
            <select
              value={progress.examFrequency}
              disabled={disabled}
              onChange={(event) => onAction({ action: "setFrequency", frequency: event.target.value })}
            >
              <option value="unknown">待定</option>
              <option value="high">高频</option>
              <option value="medium">中频</option>
              <option value="low">低频</option>
            </select>
          </label>
        </div>
        <p className="review-reason">{reason}</p>
        <h3><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></h3>
        {item.topic && <p className="question-topic">{item.topic}</p>}
        <div className="method-row">{item.methods.slice(0, 4).map((method) => <span key={method}>{method}</span>)}</div>
        <details onToggle={(event) => {
          if (event.currentTarget.open) setHasOpened(true);
        }}>
          <summary>展开题目与完整推导</summary>
          {hasOpened && <div className="detail-content"><MarkdownContent value={item.content} /><p className="source-note">来源：{item.sourcePath}</p></div>}
        </details>
        <div className="review-actions">
          <button className="result-wrong" disabled={disabled} onClick={() => onAction({ action: "review", result: "wrong" })}>做错了</button>
          <button className="result-hard" disabled={disabled} onClick={() => onAction({ action: "review", result: "hard" })}>有点模糊</button>
          <button className="result-correct" disabled={disabled} onClick={() => onAction({ action: "review", result: "correct" })}>做对了</button>
          <label className="master-checkbox master-action">
            <input type="checkbox" checked={false} disabled={disabled} onChange={() => onAction({ action: "master" })} />
            <span>已掌握，不再出现</span>
          </label>
        </div>
      </div>
    </article>
  );
}

function PastExamCard({
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
