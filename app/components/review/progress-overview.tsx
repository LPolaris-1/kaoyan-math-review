"use client";

import { useMemo, useState } from "react";
import {
  getReviewProgressMeta,
  getTimelineNodes,
} from "../../../lib/review-schedule.mjs";
import { InlineMathMarkdown } from "../inline-math-markdown";

type ReviewItem = {
  id: string;
  title: string;
  titleMarkdown?: string;
  subject: string;
  chapter: string;
  topic: string;
};

type Progress = {
  itemId: string;
  masteryLevel: number;
  examFrequency: "high" | "medium" | "low" | "unknown";
  reviewStage: number;
  nextReviewDate: string;
  mastered: boolean;
  cycleStartedAt: string | null;
  lastReviewedAt: string | null;
  lastResult: string | null;
};

type Entry = { item: ReviewItem; progress: Progress };
type ProgressMeta = ReturnType<typeof getReviewProgressMeta>;
type TimelineNode = ReturnType<typeof getTimelineNodes>[number];

const frequencyLabels = { high: "高频", medium: "中频", low: "低频", unknown: "考频待定" };
const stageLabels: Record<string, string> = {
  "0": "未开始",
  "1": "Day 2",
  "2": "Day 4",
  "3": "Day 7",
  "4": "Day 15",
  "5": "Day 30",
  "6": "长期巩固",
};

type FilterState = {
  query: string;
  status: string;
  subject: string;
  stage: string;
  frequency: string;
  mastery: string;
  sort: "next" | "recent" | "mastery";
};

export function ProgressOverview({
  entries,
  today,
  savingId,
  onUpdate,
  onReviewNow,
}: {
  entries: Entry[];
  today: string;
  savingId: string;
  onUpdate: (itemId: string, payload: Record<string, string>) => void;
  onReviewNow: (itemId: string) => void;
}) {
  const [filters, setFilters] = useState<FilterState>({
    query: "",
    status: "all",
    subject: "all",
    stage: "all",
    frequency: "all",
    mastery: "all",
    sort: "next",
  });
  const subjects = useMemo(
    () => Array.from(new Set(entries.map(({ item }) => item.subject).filter(Boolean))).sort(),
    [entries],
  );
  const decorated = useMemo(
    () => entries.map((entry) => ({
      ...entry,
      meta: getReviewProgressMeta(entry.progress, today),
      nodes: getTimelineNodes(entry.progress, today),
    })),
    [entries, today],
  );
  const stats = useMemo(() => ({
    total: decorated.length,
    due: decorated.filter(({ meta }) => meta.phase !== "unstarted" && meta.isDueToday).length,
    overdue: decorated.filter(({ meta }) => meta.phase !== "unstarted" && meta.isOverdue).length,
    waiting: decorated.filter(({ meta }) => meta.phase === "active" && !meta.isDueToday && !meta.isOverdue).length,
    unstarted: decorated.filter(({ meta }) => meta.phase === "unstarted").length,
    mastered: decorated.filter(({ meta }) => meta.phase === "mastered").length,
  }), [decorated]);
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return decorated
      .filter(({ item, progress, meta }) => {
        if (query && !`${item.title} ${item.titleMarkdown ?? ""}`.toLowerCase().includes(query)) return false;
        if (filters.subject !== "all" && item.subject !== filters.subject) return false;
        if (filters.frequency !== "all" && progress.examFrequency !== filters.frequency) return false;
        if (filters.stage !== "all" && String(progress.reviewStage) !== filters.stage) return false;
        if (filters.mastery === "low" && progress.masteryLevel > 1) return false;
        if (filters.mastery === "mid" && (progress.masteryLevel < 2 || progress.masteryLevel > 3)) return false;
        if (filters.mastery === "high" && progress.masteryLevel < 4) return false;
        if (filters.status === "due" && !(meta.phase !== "unstarted" && meta.isDueToday)) return false;
        if (filters.status === "overdue" && !(meta.phase !== "unstarted" && meta.isOverdue)) return false;
        if (filters.status === "waiting" && !(meta.phase === "active" && !meta.isDueToday && !meta.isOverdue)) return false;
        if (filters.status === "unstarted" && meta.phase !== "unstarted") return false;
        if (filters.status === "mastered" && meta.phase !== "mastered") return false;
        return true;
      })
      .sort((a, b) => {
        if (a.meta.phase === "unstarted" && b.meta.phase !== "unstarted") return 1;
        if (a.meta.phase !== "unstarted" && b.meta.phase === "unstarted") return -1;
        if (filters.sort === "recent") return (b.progress.lastReviewedAt ?? "").localeCompare(a.progress.lastReviewedAt ?? "") || a.item.id.localeCompare(b.item.id);
        if (filters.sort === "mastery") return b.progress.masteryLevel - a.progress.masteryLevel || a.item.id.localeCompare(b.item.id);
        const aDate = a.progress.nextReviewDate || "9999-12-31";
        const bDate = b.progress.nextReviewDate || "9999-12-31";
        return aDate.localeCompare(bDate) || a.item.id.localeCompare(b.item.id);
      });
  }, [decorated, filters]);

  const setFilter = (key: keyof FilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value } as FilterState));
  };

  return (
    <section className="rolling-section progress-overview">
      <div className="section-heading">
        <div><p className="section-kicker">ALL PROGRESS / 全部进度</p><h2>每一道题的复习位置</h2></div>
        <p>计划日期由本轮 Day 1 和调度状态机计算；这里只做查看、筛选和 Day 1 管理。</p>
      </div>
      <div className="progress-stats" aria-label="全部进度统计">
        <Stat label="全部题目" value={stats.total} />
        <Stat label="今日到期" value={stats.due} />
        <Stat label="已逾期" value={stats.overdue} />
        <Stat label="等待复习" value={stats.waiting} />
        <Stat label="未设置 Day 1" value={stats.unstarted} />
        <Stat label="已掌握" value={stats.mastered} />
      </div>
      <div className="progress-filters" aria-label="筛选全部进度">
        <input aria-label="搜索题目" placeholder="搜索题目标题" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} />
        <select aria-label="状态" value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
          <option value="all">全部状态</option><option value="due">今日到期</option><option value="overdue">已逾期</option><option value="waiting">等待复习</option><option value="unstarted">未设置 Day 1</option><option value="mastered">已掌握</option>
        </select>
        <select aria-label="学科" value={filters.subject} onChange={(event) => setFilter("subject", event.target.value)}><option value="all">全部学科</option>{subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select>
        <select aria-label="阶段" value={filters.stage} onChange={(event) => setFilter("stage", event.target.value)}><option value="all">全部阶段</option>{Object.entries(stageLabels).map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}</select>
        <select aria-label="考频" value={filters.frequency} onChange={(event) => setFilter("frequency", event.target.value)}><option value="all">全部考频</option>{Object.entries(frequencyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="掌握度" value={filters.mastery} onChange={(event) => setFilter("mastery", event.target.value)}><option value="all">全部掌握度</option><option value="low">0–1</option><option value="mid">2–3</option><option value="high">4–5</option></select>
        <select aria-label="排序" value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="next">下一次复习</option><option value="recent">最近复习</option><option value="mastery">掌握度</option></select>
      </div>
      <p className="progress-result-count">显示 {filtered.length} / {decorated.length} 道题</p>
      <div className="progress-card-list">
        {filtered.map((entry) => <ProgressCard key={entry.item.id} {...entry} today={today} saving={savingId === entry.item.id} onUpdate={onUpdate} onReviewNow={onReviewNow} />)}
        {!filtered.length && <div className="empty-card">没有符合当前筛选条件的题目。</div>}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="progress-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function ProgressCard({
  item,
  progress,
  meta,
  nodes,
  today,
  saving,
  onUpdate,
  onReviewNow,
}: {
  item: ReviewItem;
  progress: Progress;
  meta: ProgressMeta;
  nodes: TimelineNode[];
  today: string;
  saving: boolean;
  onUpdate: (itemId: string, payload: Record<string, string>) => void;
  onReviewNow: (itemId: string) => void;
}) {
  const [draftDate, setDraftDate] = useState(progress.cycleStartedAt ?? today);
  const unstarted = meta.phase === "unstarted";
  const saveCycleStart = () => onUpdate(item.id, { action: "setCycleStart", cycleStartedAt: draftDate });
  return (
    <article className="progress-card">
      <div className="progress-card-header"><div><div className="progress-card-meta"><span>{item.subject}</span><span>{frequencyLabels[progress.examFrequency as keyof typeof frequencyLabels]}</span><span>掌握度 {progress.masteryLevel}/5</span></div><h3><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></h3><p>{item.topic || item.chapter || "未标注章节/知识点"}</p></div><span className={`progress-status progress-status-${meta.phase}`}>{unstarted ? "尚未设置艾宾浩斯 Day 1" : meta.statusLabel}</span></div>
      <div className="cycle-editor"><label>Day 1 <input type="date" max={today} value={draftDate} onChange={(event) => setDraftDate(event.target.value)} disabled={saving} /></label><button type="button" onClick={saveCycleStart} disabled={saving || !draftDate}>{unstarted ? "保存 Day 1" : "修改 Day 1"}</button>{unstarted && <button type="button" onClick={() => { setDraftDate(today); onUpdate(item.id, { action: "setCycleStart", cycleStartedAt: today }); }} disabled={saving}>今天设为 Day 1</button>}</div>
      <div className={`progress-timeline ${unstarted ? "timeline-unstarted" : ""}`} aria-label={`${item.title} 艾宾浩斯时间轴`}>
        {nodes.map((node) => <div className={`timeline-node timeline-${node.status} ${node.day === meta.currentTargetDay ? "timeline-target" : ""}`} key={node.day}><strong>Day {node.day}</strong><span>{node.plannedDate ? formatShortDate(node.plannedDate) : "—"}</span><small>{node.day === meta.currentTargetDay && meta.isDueToday ? "今天到期" : node.day === meta.currentTargetDay && meta.isOverdue ? `逾期 ${meta.overdueDays} 天` : node.status === "completed" ? "已完成" : node.status === "missed" ? "已逾期" : node.status === "current" ? "当前节点" : "未来"}</small></div>)}
      </div>
      <div className="progress-card-footer"><span>当前阶段：{meta.phase === "mastered" ? "已掌握" : stageLabels[String(progress.reviewStage)]}</span><span>下一节点：{meta.phase === "mastered" ? "不再安排" : meta.currentTargetDay ? `Day ${meta.currentTargetDay}` : "等待设置 Day 1"}</span><span>下一次：{meta.phase === "mastered" ? "不再安排" : progress.nextReviewDate}{meta.isOverdue ? `（逾期 ${meta.overdueDays} 天）` : meta.isDueToday ? "（今天）" : meta.daysUntilReview ? `（还有 ${meta.daysUntilReview} 天）` : ""}</span><span>最近：{progress.lastResult ?? "暂无"}{progress.lastReviewedAt ? ` · ${formatDateTime(progress.lastReviewedAt)}` : ""}</span>{meta.phase !== "unstarted" && meta.phase !== "mastered" && <button type="button" className="immediate-review-button" onClick={() => onReviewNow(item.id)} disabled={saving}>立即复习</button>}</div>
    </article>
  );
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatDateTime(value: string) {
  return value.slice(0, 10);
}
