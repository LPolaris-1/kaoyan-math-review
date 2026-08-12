export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];
export const FREQUENCIES = ["high", "medium", "low", "unknown"];

export function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [values.year, values.month, values.day].join("-");
}

export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

export function scheduleReview(progress, result, today = shanghaiToday()) {
  const mastery = clamp(Number(progress?.masteryLevel ?? 0), 0, 5);
  const stage = clamp(Number(progress?.reviewStage ?? 0), 0, REVIEW_INTERVALS.length - 1);

  if (result === "wrong") {
    return {
      masteryLevel: Math.max(0, mastery - 1),
      reviewStage: 0,
      nextReviewDate: addDays(today, 1),
      lastResult: result,
    };
  }

  if (result === "hard") {
    return {
      masteryLevel: mastery,
      reviewStage: stage,
      nextReviewDate: addDays(today, 1),
      lastResult: result,
    };
  }

  if (result !== "correct") throw new Error("Unsupported review result");
  return {
    masteryLevel: Math.min(5, mastery + 1),
    reviewStage: Math.min(REVIEW_INTERVALS.length - 1, stage + 1),
    nextReviewDate: addDays(today, REVIEW_INTERVALS[stage]),
    lastResult: result,
  };
}

export function quadrantFor(progress) {
  const frequency = progress?.examFrequency ?? "unknown";
  const mastered = Boolean(progress?.mastered);
  if (frequency === "high") return mastered ? "consolidation" : "blind";
  if (frequency === "low") return mastered ? "safe" : "potential";
  return frequency === "medium" ? "medium" : "unknown";
}

export function buildDailyQueue(items, progressById, today = shanghaiToday()) {
  const entries = items.map((item) => ({
    item,
    progress: normalizeProgress(progressById[item.id], item.id, today),
  }));
  const active = entries.filter(({ progress }) => !progress.mastered);
  const selected = new Set();
  const queue = [];

  const add = (entry, reason, source) => {
    if (selected.has(entry.item.id)) return;
    selected.add(entry.item.id);
    queue.push({ ...entry, reason, source });
  };

  active
    .filter(({ progress }) => progress.examFrequency === "high")
    .sort((a, b) =>
      a.progress.masteryLevel - b.progress.masteryLevel ||
      a.progress.nextReviewDate.localeCompare(b.progress.nextReviewDate) ||
      a.item.id.localeCompare(b.item.id)
    )
    .slice(0, 3)
    .forEach((entry) =>
      add(
        entry,
        "高频考点，掌握度 " + entry.progress.masteryLevel + "/5，优先补齐核心盲区",
        "core",
      )
    );

  active
    .filter(({ progress }) => progress.nextReviewDate <= today)
    .sort((a, b) =>
      a.progress.nextReviewDate.localeCompare(b.progress.nextReviewDate) ||
      a.progress.masteryLevel - b.progress.masteryLevel ||
      a.item.id.localeCompare(b.item.id)
    )
    .forEach((entry) => {
      const overdue = daysBetween(entry.progress.nextReviewDate, today);
      add(
        entry,
        overdue > 0
          ? "艾宾浩斯节点已逾期 " + overdue + " 天"
          : "今天到达艾宾浩斯复习节点",
        "due",
      );
    });

  active
    .filter(({ progress }) => progress.examFrequency === "low")
    .sort((a, b) => stableScore(today + ":" + a.item.id) - stableScore(today + ":" + b.item.id))
    .slice(0, 2)
    .forEach((entry) => add(entry, "低频未掌握考点，作为今日随机挑战保持覆盖", "challenge"));

  return queue;
}

export function normalizeProgress(progress, itemId, today = shanghaiToday()) {
  return {
    itemId,
    masteryLevel: clamp(Number(progress?.masteryLevel ?? 0), 0, 5),
    examFrequency: FREQUENCIES.includes(progress?.examFrequency)
      ? progress.examFrequency
      : "unknown",
    reviewStage: clamp(Number(progress?.reviewStage ?? 0), 0, REVIEW_INTERVALS.length - 1),
    nextReviewDate: progress?.nextReviewDate || today,
    mastered: Boolean(progress?.mastered),
    lastReviewedAt: progress?.lastReviewedAt ?? null,
    lastResult: progress?.lastResult ?? null,
    updatedAt: progress?.updatedAt ?? null,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function daysBetween(from, to) {
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function stableScore(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
