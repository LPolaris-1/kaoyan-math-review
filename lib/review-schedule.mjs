export const EBBINGHAUS_DAYS = [1, 2, 4, 7, 15, 30];
// Backwards-compatible name for callers that still import the old constant.
export const REVIEW_INTERVALS = EBBINGHAUS_DAYS;
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

export function plannedDateForDay(cycleStartedAt, day) {
  if (!cycleStartedAt) return null;
  const index = EBBINGHAUS_DAYS.indexOf(Number(day));
  if (index < 0) throw new Error("Unsupported Ebbinghaus day");
  return addDays(cycleStartedAt, EBBINGHAUS_DAYS[index] - 1);
}

export function stageTargetDay(reviewStage) {
  const stage = clamp(Number(reviewStage ?? 0), 0, 6);
  if (stage === 0) return null;
  return EBBINGHAUS_DAYS[Math.min(stage, EBBINGHAUS_DAYS.length - 1)];
}

export function scheduleReview(progress, result, today = shanghaiToday()) {
  const normalized = normalizeProgress(progress, progress?.itemId, today);
  const mastery = normalized.masteryLevel;
  const stage = normalized.reviewStage;
  const cycleStartedAt = normalized.cycleStartedAt;

  if (result === "wrong") {
    return {
      masteryLevel: Math.max(0, mastery - 1),
      reviewStage: 0,
      nextReviewDate: addDays(today, 1),
      cycleStartedAt: null,
      lastResult: result,
    };
  }

  if (result === "hard") {
    return {
      masteryLevel: mastery,
      reviewStage: stage,
      nextReviewDate: addDays(today, 1),
      cycleStartedAt,
      lastResult: result,
    };
  }

  if (result !== "correct") throw new Error("Unsupported review result");

  // A first correct review establishes Day 1. An early correct review only
  // improves mastery; it must not move the absolute timeline forward.
  if (!cycleStartedAt || stage === 0) {
    return {
      masteryLevel: Math.min(5, mastery + 1),
      reviewStage: 1,
      nextReviewDate: addDays(today, 1),
      cycleStartedAt: today,
      lastResult: result,
    };
  }

  if (today < normalized.nextReviewDate) {
    return {
      masteryLevel: Math.min(5, mastery + 1),
      reviewStage: stage,
      nextReviewDate: normalized.nextReviewDate,
      cycleStartedAt,
      lastResult: result,
    };
  }

  if (stage === 6) {
    return {
      masteryLevel: Math.min(5, mastery + 1),
      reviewStage: 6,
      nextReviewDate: addDays(today, 30),
      cycleStartedAt,
      lastResult: result,
    };
  }

  if (stage === 5) {
    return {
      masteryLevel: Math.min(5, mastery + 1),
      reviewStage: 6,
      nextReviewDate: addDays(today, 30),
      cycleStartedAt,
      lastResult: result,
    };
  }

  const nextStage = stage + 1;
  const nextTargetDay = stageTargetDay(nextStage);
  const plannedNextDate = plannedDateForDay(cycleStartedAt, nextTargetDay);
  return {
    masteryLevel: Math.min(5, mastery + 1),
    reviewStage: nextStage,
    nextReviewDate:
      plannedNextDate <= today ? addDays(today, 1) : plannedNextDate,
    cycleStartedAt,
    lastResult: result,
  };
}

export function getReviewProgressMeta(progress, today = shanghaiToday()) {
  const normalized = normalizeProgress(progress, progress?.itemId, today);
  const { cycleStartedAt, reviewStage: stage, nextReviewDate } = normalized;
  const targetDay = cycleStartedAt ? stageTargetDay(stage) : null;
  const plannedTargetDate =
    cycleStartedAt && targetDay && stage < 6
      ? plannedDateForDay(cycleStartedAt, targetDay)
      : null;
  const isDueToday = !normalized.mastered && nextReviewDate === today;
  const isOverdue = !normalized.mastered && nextReviewDate < today;
  const overdueDays = isOverdue ? daysBetween(nextReviewDate, today) : 0;
  const daysUntilReview = nextReviewDate > today ? daysBetween(today, nextReviewDate) : 0;
  const phase = normalized.mastered
    ? "mastered"
    : !cycleStartedAt
      ? "unstarted"
      : stage === 6
        ? "maintenance"
        : "active";
  const isSupplementalRetry =
    phase === "active" && Boolean(plannedTargetDate) && nextReviewDate !== plannedTargetDate;

  let statusLabel;
  if (phase === "mastered") statusLabel = "已掌握";
  else if (phase === "unstarted") statusLabel = "尚未设置 Day 1";
  else if (phase === "maintenance")
    statusLabel = `长期巩固 · 下一次 ${nextReviewDate}`;
  else if (isSupplementalRetry) statusLabel = `Day ${targetDay} · 补强中`;
  else if (isOverdue) statusLabel = `Day ${targetDay} · 已逾期 ${overdueDays} 天`;
  else if (isDueToday) statusLabel = `Day ${targetDay} · 今天复习`;
  else statusLabel = `等待 Day ${targetDay} · ${nextReviewDate}`;

  return {
    phase,
    cycleStartedAt,
    currentTargetDay: targetDay,
    plannedTargetDate,
    nextReviewDate,
    isDueToday,
    isOverdue,
    overdueDays,
    daysUntilReview,
    isSupplementalRetry,
    statusLabel,
  };
}

export function getTimelineNodes(progress, today = shanghaiToday()) {
  const normalized = normalizeProgress(progress, progress?.itemId, today);
  const { cycleStartedAt, reviewStage: stage } = normalized;
  const targetDay = cycleStartedAt ? stageTargetDay(stage) : null;

  return EBBINGHAUS_DAYS.map((day) => {
    const plannedDate = cycleStartedAt ? plannedDateForDay(cycleStartedAt, day) : null;
    let status = "future";
    if (cycleStartedAt && stage >= 6) status = "completed";
    else if (cycleStartedAt && targetDay && day < targetDay) status = "completed";
    else if (cycleStartedAt && day === targetDay)
      status = plannedDate < today ? "missed" : "current";
    return { day, plannedDate, status };
  });
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
    .filter(({ item, progress }) => isIntakePending(item, progress, today))
    // Newer imports are closer to today and should be reviewed first. Keep
    // input order for questions imported on the same day.
    .sort((a, b) => b.item.date.localeCompare(a.item.date))
    .forEach((entry) => {
      const waitingDays = daysBetween(entry.item.date, today);
      add(
        entry,
        `首次复习待办：${entry.item.date} 导入，已等待 ${waitingDays} 天`,
        "intake",
      );
    });

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
    .filter(({ item, progress }) =>
      progress.cycleStartedAt
        ? progress.nextReviewDate <= today
        : isIntakePending(item, progress, today)
    )
    .sort((a, b) =>
      b.progress.nextReviewDate.localeCompare(a.progress.nextReviewDate) ||
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

  // Keep the queue order explicit: due today first, overdue second, then
  // everything else from the nearest scheduled date to the farthest.
  return queue.sort((a, b) => {
    const rank = (entry) => {
      if (entry.source === "intake") return 0;
      if (entry.progress.cycleStartedAt && entry.progress.nextReviewDate === today) return 0;
      if (entry.progress.cycleStartedAt && entry.progress.nextReviewDate < today) return 1;
      return 2;
    };
    const aRank = rank(a);
    const bRank = rank(b);
    if (aRank !== bRank) return aRank - bRank;

    // Intake items are all due today, with the newest import first. Returning
    // zero for same-day imports preserves history.json order for that tie.
    if (a.source === "intake" && b.source === "intake") {
      return b.item.date.localeCompare(a.item.date);
    }
    if (aRank === 1) {
      // Among overdue items, the one closest to today comes first.
      return b.progress.nextReviewDate.localeCompare(a.progress.nextReviewDate)
        || a.progress.masteryLevel - b.progress.masteryLevel
        || a.item.id.localeCompare(b.item.id);
    }
    if (aRank === 2) {
      return dayDistance(today, a.progress.nextReviewDate) - dayDistance(today, b.progress.nextReviewDate)
        || a.progress.nextReviewDate.localeCompare(b.progress.nextReviewDate)
        || a.item.id.localeCompare(b.item.id);
    }
    return a.progress.masteryLevel - b.progress.masteryLevel || a.item.id.localeCompare(b.item.id);
  });
}

/**
 * Derive a stable per-day review summary from the initial queue snapshot and
 * formal review events. The queue snapshot keeps the denominator stable even
 * after a result changes the live queue.
 */
export function buildTodayProgress(queueEntries, events, today = shanghaiToday(), initialQueueIds) {
  const ids = new Set(
    (initialQueueIds ?? queueEntries ?? [])
      .map((entry) => typeof entry === "string" ? entry : entry?.item?.id ?? entry?.id)
      .filter(Boolean),
  );
  const completed = new Set(
    (events ?? [])
      .filter((event) => event?.occurredDate === today)
      .filter((event) =>
        (event?.eventType === "review" && ["correct", "hard", "wrong"].includes(event?.result)) ||
        event?.eventType === "master",
      )
      .map((event) => event?.itemId)
      .filter(Boolean),
  );
  // A user can continue reviewing after the original queue snapshot has
  // changed, so reviewed items outside that snapshot must still count today.
  const total = Math.max(ids.size, completed.size);
  return {
    completed: completed.size,
    total,
    remaining: Math.max(0, total - completed.size),
    isComplete: total > 0 && completed.size === total,
  };
}

export function isIntakePending(item, progress, today = shanghaiToday()) {
  const normalized = normalizeProgress(progress, item?.id, today);
  return Boolean(
    item?.date &&
    item.date < today &&
    !normalized.cycleStartedAt &&
    !normalized.mastered
  );
}

export function normalizeProgress(progress, itemId, today = shanghaiToday()) {
  return {
    itemId,
    masteryLevel: clamp(Number(progress?.masteryLevel ?? 0), 0, 5),
    examFrequency: FREQUENCIES.includes(progress?.examFrequency)
      ? progress.examFrequency
      : "unknown",
    reviewStage: clamp(Number(progress?.reviewStage ?? 0), 0, 6),
    nextReviewDate: progress?.nextReviewDate || today,
    cycleStartedAt: progress?.cycleStartedAt ?? progress?.cycle_started_at ?? null,
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

function dayDistance(from, to) {
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  return Math.abs(Math.round((end - start) / 86_400_000));
}

function stableScore(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
