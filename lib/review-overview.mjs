import {
  addDays,
  getReviewProgressMeta,
  quadrantFor,
} from "./review-schedule.mjs";

export const OVERVIEW_RANGES = [7, 30, 60];

export function calculateReviewSummary(entries, today) {
  const decorated = decorateEntries(entries, today);
  const scheduled = decorated.filter(({ meta, progress }) => meta.phase !== "unstarted" && meta.phase !== "mastered" && isValidDate(progress.nextReviewDate));
  return {
    dueToday: scheduled.filter(({ meta }) => meta.isDueToday).length,
    overdue: scheduled.filter(({ meta }) => meta.isOverdue).length,
    future7: scheduled.filter(({ progress }) => withinFuture(progress.nextReviewDate, today, 7)).length,
    future30: scheduled.filter(({ progress }) => withinFuture(progress.nextReviewDate, today, 30)).length,
    unstarted: decorated.filter(({ meta }) => meta.phase === "unstarted").length,
  };
}

export function groupReviewsByDate(entries, today, rangeDays = 30) {
  const end = addDays(today, Math.max(0, rangeDays - 1));
  const groups = new Map();
  for (const entry of decorateEntries(entries, today)) {
    const { progress, meta } = entry;
    if (meta.phase === "unstarted" || meta.phase === "mastered" || meta.isOverdue || !isValidDate(progress.nextReviewDate)) continue;
    const date = progress.nextReviewDate;
    if (!date || date < today || date > end) continue;
    const list = groups.get(date) ?? [];
    list.push({ ...entry, scheduleDay: scheduleDay(meta) });
    groups.set(date, list);
  }
  return Array.from(groups, ([date, dateEntries]) => ({
    date,
    entries: dateEntries.sort(compareEntries),
    count: dateEntries.length,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export function groupOverdue(entries, today) {
  return decorateEntries(entries, today)
    .filter(({ meta, progress }) => meta.phase !== "unstarted" && meta.phase !== "mastered" && meta.isOverdue && isValidDate(progress.nextReviewDate))
    .map((entry) => ({ ...entry, scheduleDay: scheduleDay(entry.meta) }))
    .sort((a, b) => a.progress.nextReviewDate.localeCompare(b.progress.nextReviewDate) || compareEntries(a, b));
}

export function groupByScheduleDay(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.scheduleDay;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return Array.from(groups, ([label, groupedEntries]) => ({ label, entries: groupedEntries }));
}

export function buildQuadrantEntries(entries, key = "all") {
  return key === "all" ? entries : entries.filter(({ progress }) => quadrantFor(progress) === key);
}

export function loadLevel(count, maxCount) {
  if (!count) return "empty";
  if (count >= Math.max(1, maxCount * 0.75)) return "high";
  if (count >= Math.max(1, maxCount * 0.35)) return "medium";
  return "low";
}

function decorateEntries(entries, today) {
  return entries.map((entry) => ({
    ...entry,
    meta: getReviewProgressMeta(entry.progress, today),
  }));
}

function withinFuture(date, today, days) {
  return date > today && date <= addDays(today, days);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function scheduleDay(meta) {
  if (meta.phase === "maintenance") return "长期巩固";
  return meta.currentTargetDay ? `Day ${meta.currentTargetDay}` : "未标记";
}

function compareEntries(a, b) {
  return a.item.id.localeCompare(b.item.id);
}
