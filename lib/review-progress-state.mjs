import {
  normalizeProgress,
  plannedDateForDay,
  scheduleReview,
  stageTargetDay,
} from "./review-schedule.mjs";

/**
 * @param {{
 *   base: Record<string, any>,
 *   action: "review" | "master" | "unmaster" | "setCycleStart" | "setFrequency",
 *   result?: "wrong" | "hard" | "correct" | null,
 *   frequency?: string | null,
 *   cycleStartedAt?: string | null,
 *   today: string,
 *   now: string,
 * }} input
 */
export function buildReviewAction({
  base,
  action,
  result = null,
  frequency = null,
  cycleStartedAt = null,
  today,
  now,
}) {
  const before = normalizeProgress(base, base?.itemId, today);
  let changes;
  let eventType = null;
  let eventResult = null;

  switch (action) {
    case "review":
      changes = {
        ...scheduleReview(base, result, today),
        mastered: 0,
        lastReviewedAt: now,
        updatedAt: now,
      };
      eventType = "review";
      eventResult = result;
      break;
    case "master":
      changes = { mastered: 1, masteryLevel: 5, updatedAt: now };
      eventType = "master";
      break;
    case "unmaster":
      changes = { mastered: 0, nextReviewDate: today, updatedAt: now };
      eventType = "unmaster";
      break;
    case "setCycleStart": {
      const reviewStage = before.reviewStage === 0 ? 1 : before.reviewStage;
      const targetDay = stageTargetDay(reviewStage);
      const nextReviewDate =
        reviewStage === 6
          ? before.nextReviewDate
          : plannedDateForDay(cycleStartedAt, targetDay ?? 2);
      changes = {
        cycleStartedAt,
        reviewStage,
        nextReviewDate,
        updatedAt: now,
      };
      eventType = "set_cycle_start";
      break;
    }
    case "setFrequency":
      changes = { examFrequency: frequency ?? "unknown", updatedAt: now };
      break;
    default:
      throw new Error("Unsupported review action");
  }

  if (!eventType) return { before, changes, event: null };

  const eventProgress = eventType === "set_cycle_start"
    ? { ...before, ...changes }
    : before;
  const targetDay = eventProgress.cycleStartedAt
    ? stageTargetDay(eventProgress.reviewStage)
    : null;
  const scheduledDate =
    eventProgress.cycleStartedAt && targetDay && eventProgress.reviewStage < 6
      ? plannedDateForDay(eventProgress.cycleStartedAt, targetDay)
      : eventProgress.nextReviewDate;

  return {
    before,
    changes,
    event: {
      eventType,
      result: eventResult,
      occurredAt: now,
      occurredDate: today,
      cycleStartedAt: eventProgress.cycleStartedAt,
      targetDay,
      scheduledDate,
      reviewStageBefore: before.reviewStage,
      reviewStageAfter: Number(changes.reviewStage ?? before.reviewStage),
      createdAt: now,
    },
  };
}
