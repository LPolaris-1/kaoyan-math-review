"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import { getReviewProgressMeta, quadrantFor } from "../../../lib/review-schedule.mjs";
import {
  OVERVIEW_RANGES,
  calculateReviewSummary,
  groupByScheduleDay,
  groupOverdue,
  groupReviewsByDate,
  loadLevel,
} from "../../../lib/review-overview.mjs";
import { filterByQuadrants, toggleQuadrant } from "../../../lib/review-navigation.mjs";
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
type ReviewMeta = {
  phase: "mastered" | "unstarted" | "maintenance" | "active";
  currentTargetDay: number | null;
  nextReviewDate: string;
  isDueToday: boolean;
  isOverdue: boolean;
  overdueDays: number;
  daysUntilReview: number;
  statusLabel: string;
};
type OverviewEntry = Entry & { meta: ReviewMeta; scheduleDay?: string };
type QuadrantKey = "all" | "blind" | "potential" | "consolidation" | "safe";
type ReviewQueryPatch = { range?: 7 | 30 | 60; date?: string | null; quadrants?: string[]; itemId?: string | null };

const quadrantMeta: Record<Exclude<QuadrantKey, "all">, { label: string; caption: string }> = {
  blind: { label: "核心盲区", caption: "未掌握 × 高频" },
  potential: { label: "提分潜力", caption: "未掌握 × 低频" },
  consolidation: { label: "巩固区", caption: "已掌握 × 高频" },
  safe: { label: "安全区", caption: "已掌握 × 低频" },
};

export function ReviewOverview({
  entries,
  today,
  range,
  selectedDate,
  quadrants,
  focusItemId,
  onUpdateQuery,
  onKpiNavigate,
  onViewProgress,
  onReviewNow,
}: {
  entries: Entry[];
  today: string;
  range: 7 | 30 | 60;
  selectedDate: string | null;
  quadrants: string[];
  focusItemId: string | null;
  onUpdateQuery: (patch: ReviewQueryPatch) => void;
  onKpiNavigate: (focus: "due" | "overdue" | "unstarted") => void;
  onViewProgress: (itemId: string) => void;
  onReviewNow: (itemId: string) => void;
}) {
  const filteredEntries = useMemo(() => filterByQuadrants(entries, quadrants), [entries, quadrants]);
  const summary = useMemo(() => calculateReviewSummary(filteredEntries, today), [filteredEntries, today]);
  const dateGroups = useMemo(() => groupReviewsByDate(filteredEntries, today, range), [filteredEntries, today, range]);
  const overdue = useMemo(() => groupOverdue(filteredEntries, today), [filteredEntries, today]);
  const focusedDate = focusItemId ? dateGroups.find((group) => group.entries.some(({ item }) => item.id === focusItemId))?.date ?? null : null;
  const selected = dateGroups.find((group) => group.date === (selectedDate ?? focusedDate)) ?? null;
  const focusedEntry = focusItemId ? filteredEntries.find(({ item }) => item.id === focusItemId) : null;
  const focusedInDate = Boolean(selected?.entries.some(({ item }) => item.id === focusItemId));
  const focusedInOverdue = Boolean(overdue.some(({ item }) => item.id === focusItemId));
  const focusedOnly = focusedEntry && !focusedInDate && !focusedInOverdue
    ? { ...focusedEntry, meta: getReviewProgressMeta(focusedEntry.progress, today) }
    : null;
  const maxLoad = Math.max(1, ...dateGroups.map((group) => group.count));

  useEffect(() => {
    if (!focusItemId) return;
    const target = document.getElementById(`overview-item-${encodeURIComponent(focusItemId)}`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusItemId, selected?.date, overdue.length]);

  return (
    <section className="rolling-section review-overview">
      <div className="section-heading">
        <div><p className="section-kicker">REVIEW OVERVIEW / 复习总览</p><h2>看清接下来每一天的复习负载</h2></div>
        <p>时间轴由当前复习进度派生，不重新请求 API；逾期题单独保留，不会被挪进今天。</p>
      </div>

      <div className="overview-kpi-grid" aria-label="复习总览统计">
        <Kpi label="今日到期" value={summary.dueToday} onClick={() => onKpiNavigate("due")} />
        <Kpi label="已逾期" value={summary.overdue} onClick={() => onKpiNavigate("overdue")} />
        <Kpi label="未来 7 天" value={summary.future7} onClick={() => onUpdateQuery({ range: 7, date: null, itemId: null })} />
        <Kpi label="未来 30 天" value={summary.future30} onClick={() => onUpdateQuery({ range: 30, date: null, itemId: null })} />
        <Kpi label="未设置 Day 1" value={summary.unstarted} onClick={() => onKpiNavigate("unstarted")} />
      </div>

      <div className="overview-toolbar">
        <div className="overview-range" role="group" aria-label="时间轴范围">
          {OVERVIEW_RANGES.map((days) => <button key={days} type="button" className={range === days ? "is-active" : ""} aria-pressed={range === days} onClick={() => onUpdateQuery({ range: days as 7 | 30 | 60, date: null, itemId: null })}>{days} 天</button>)}
        </div>
        {quadrants.length > 0 && <button type="button" className="clear-overview-filter" onClick={() => onUpdateQuery({ quadrants: [], date: null, itemId: null })}>清除象限筛选</button>}
      </div>

      <div className="overview-timeline" aria-label={`未来 ${range} 天复习时间轴`}>
        {dateGroups.map((group) => (
          <button type="button" key={group.date} className={`overview-day overview-load-${loadLevel(group.count, maxLoad)} ${(selected?.date === group.date) ? "is-selected" : ""}`} onClick={() => onUpdateQuery({ date: selected?.date === group.date ? null : group.date, itemId: null })}>
            <strong>{formatDate(group.date)}</strong>
            <span>{group.count} 题</span>
            <i style={{ "--load": `${Math.max(18, Math.round(group.count / maxLoad * 100))}%` } as CSSProperties} />
          </button>
        ))}
        {!dateGroups.length && <div className="empty-card">当前筛选范围内没有有效复习计划。</div>}
      </div>

      {selected && <DateDetails group={selected} focusItemId={focusItemId} onReviewNow={onReviewNow} onViewProgress={onViewProgress} />}

      {overdue.length > 0 && (
        <details className="overview-overdue" open>
          <summary>已逾期 {overdue.length} 题（不自动并入今日）</summary>
          <div className="overview-overdue-list">
            {overdue.map((entry) => <OverviewItem key={entry.item.id} entry={entry} focusItemId={focusItemId} onReviewNow={onReviewNow} onViewProgress={onViewProgress} />)}
          </div>
        </details>
      )}

      {focusedOnly && <section className="overview-date-details"><div className="overview-subheading"><h3>当前题目</h3><span>该题暂无可展开的未来日期分组</span></div><OverviewItem entry={focusedOnly} focusItemId={focusItemId} onReviewNow={onReviewNow} onViewProgress={onViewProgress} /></section>}

      <div className="overview-quadrants">
        <div className="overview-subheading"><h3>四象限</h3><span>可多选；KPI、时间轴和详情按“或”同步过滤。</span></div>
        <div className="overview-quadrant-grid">
          {(Object.keys(quadrantMeta) as Array<Exclude<QuadrantKey, "all">>).map((key) => {
            const count = entries.filter(({ progress }) => quadrantFor(progress) === key).length;
            const isSelected = quadrants.includes(key);
            return <button type="button" key={key} aria-pressed={isSelected} className={`overview-quadrant overview-quadrant-${key} ${isSelected ? "is-selected" : ""}`} onClick={() => onUpdateQuery({ quadrants: toggleQuadrant(quadrants, key), date: null, itemId: null })}><span>{quadrantMeta[key].caption}</span><strong>{count}</strong><b>{quadrantMeta[key].label}</b></button>;
          })}
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className="overview-kpi" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}

function DateDetails({ group, focusItemId, onReviewNow, onViewProgress }: { group: { date: string; count: number; entries: OverviewEntry[] }; focusItemId: string | null; onReviewNow: (itemId: string) => void; onViewProgress: (itemId: string) => void }) {
  return <section className="overview-date-details"><div className="overview-subheading"><h3>{group.date} · 共 {group.count} 题</h3><span>按艾宾浩斯节点分组</span></div>{groupByScheduleDay(group.entries).map(({ label, entries }) => <div className="overview-day-group" key={label}><h4>{label}<small>{entries.length} 题</small></h4>{entries.map((entry) => <OverviewItem key={entry.item.id} entry={entry} focusItemId={focusItemId} onReviewNow={onReviewNow} onViewProgress={onViewProgress} />)}</div>)}</section>;
}

function OverviewItem({ entry, focusItemId, onReviewNow, onViewProgress }: { entry: OverviewEntry; focusItemId: string | null; onReviewNow: (itemId: string) => void; onViewProgress: (itemId: string) => void }) {
  const { item, progress, meta } = entry;
  return <article id={`overview-item-${encodeURIComponent(item.id)}`} className={`overview-item ${focusItemId === item.id ? "is-focused" : ""}`}><div><h4><InlineMathMarkdown value={item.titleMarkdown ?? item.title} /></h4><p>{item.subject} · 阶段 {progress.reviewStage} · 掌握度 {progress.masteryLevel}/5 · {progress.examFrequency === "unknown" ? "考频待定" : progress.examFrequency}</p>{meta.isOverdue && <small>原计划 {progress.nextReviewDate}，已逾期 {meta.overdueDays} 天</small>}</div><div className="overview-item-actions"><button type="button" className="overview-view-link" onClick={() => onViewProgress(item.id)}>查看进度</button><button type="button" onClick={() => onReviewNow(item.id)} disabled={progress.mastered || !progress.cycleStartedAt}>立即复习</button></div></article>;
}

function formatDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}
