import assert from "node:assert/strict";
import test from "node:test";
import {
  EBBINGHAUS_DAYS,
  addDays,
  buildDailyQueue,
  getReviewProgressMeta,
  getTimelineNodes,
  normalizeProgress,
  plannedDateForDay,
  quadrantFor,
  scheduleReview,
  stageTargetDay,
} from "../lib/review-schedule.mjs";

test("absolute Ebbinghaus days are anchored to one Day 1", () => {
  assert.deepEqual(EBBINGHAUS_DAYS, [1, 2, 4, 7, 15, 30]);
  assert.equal(plannedDateForDay("2026-08-20", 1), "2026-08-20");
  assert.equal(plannedDateForDay("2026-08-20", 2), "2026-08-21");
  assert.equal(plannedDateForDay("2026-08-20", 4), "2026-08-23");
  assert.equal(plannedDateForDay("2026-08-20", 7), "2026-08-26");
  assert.equal(plannedDateForDay("2026-08-20", 15), "2026-09-03");
  assert.equal(plannedDateForDay("2026-08-20", 30), "2026-09-18");
});

test("the first correct review establishes Day 1 and targets Day 2", () => {
  const result = scheduleReview({ masteryLevel: 0, reviewStage: 0 }, "correct", "2026-08-20");
  assert.deepEqual(result, {
    masteryLevel: 1,
    reviewStage: 1,
    nextReviewDate: "2026-08-21",
    cycleStartedAt: "2026-08-20",
    lastResult: "correct",
  });
});

test("scheduled correct reviews advance to absolute Day 4, Day 7 and Day 15", () => {
  const day4 = scheduleReview({
    masteryLevel: 1,
    reviewStage: 1,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-21",
  }, "correct", "2026-08-21");
  assert.equal(day4.reviewStage, 2);
  assert.equal(day4.nextReviewDate, "2026-08-23");

  const day7 = scheduleReview({ ...day4 }, "correct", "2026-08-23");
  assert.equal(day7.reviewStage, 3);
  assert.equal(day7.nextReviewDate, "2026-08-26");

  const day15 = scheduleReview({ ...day7 }, "correct", "2026-08-26");
  assert.equal(day15.reviewStage, 4);
  assert.equal(day15.nextReviewDate, "2026-09-03");
});

test("Day 30 correct enters maintenance and maintenance repeats every 30 days", () => {
  const maintenance = scheduleReview({
    masteryLevel: 5,
    reviewStage: 5,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-09-18",
  }, "correct", "2026-09-18");
  assert.equal(maintenance.reviewStage, 6);
  assert.equal(maintenance.nextReviewDate, "2026-10-18");

  const next = scheduleReview({ ...maintenance }, "correct", "2026-10-18");
  assert.equal(next.reviewStage, 6);
  assert.equal(next.nextReviewDate, "2026-11-17");
});

test("hard keeps the cycle and stage but schedules next-day reinforcement", () => {
  const result = scheduleReview({
    masteryLevel: 2,
    reviewStage: 2,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-23",
  }, "hard", "2026-08-24");
  assert.deepEqual(result, {
    masteryLevel: 2,
    reviewStage: 2,
    nextReviewDate: "2026-08-25",
    cycleStartedAt: "2026-08-20",
    lastResult: "hard",
  });
});

test("wrong invalidates the current cycle and waits for a new Day 1", () => {
  const result = scheduleReview({
    masteryLevel: 3,
    reviewStage: 4,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-09-03",
  }, "wrong", "2026-09-03");
  assert.deepEqual(result, {
    masteryLevel: 2,
    reviewStage: 0,
    nextReviewDate: "2026-09-04",
    cycleStartedAt: null,
    lastResult: "wrong",
  });
});

test("early correct improves mastery without advancing the absolute timeline", () => {
  const result = scheduleReview({
    masteryLevel: 2,
    reviewStage: 2,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-23",
  }, "correct", "2026-08-21");
  assert.equal(result.masteryLevel, 3);
  assert.equal(result.reviewStage, 2);
  assert.equal(result.nextReviewDate, "2026-08-23");
  assert.equal(result.cycleStartedAt, "2026-08-20");
});

test("overdue correct keeps absolute node semantics but never schedules in the past", () => {
  const result = scheduleReview({
    masteryLevel: 1,
    reviewStage: 1,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-21",
  }, "correct", "2026-08-25");
  assert.equal(result.reviewStage, 2);
  assert.equal(result.nextReviewDate, "2026-08-26");
  assert.equal(result.cycleStartedAt, "2026-08-20");
});

test("progress metadata distinguishes active, reinforcement, maintenance and unstarted states", () => {
  const active = getReviewProgressMeta({
    reviewStage: 2,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-23",
  }, "2026-08-22");
  assert.equal(active.phase, "active");
  assert.equal(active.currentTargetDay, 4);
  assert.equal(active.plannedTargetDate, "2026-08-23");
  assert.equal(active.daysUntilReview, 1);

  const reinforcement = getReviewProgressMeta({
    reviewStage: 2,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-25",
  }, "2026-08-24");
  assert.equal(reinforcement.isSupplementalRetry, true);
  assert.equal(reinforcement.statusLabel, "Day 4 · 补强中");

  const maintenance = getReviewProgressMeta({
    reviewStage: 6,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-10-18",
  }, "2026-09-20");
  assert.equal(maintenance.phase, "maintenance");
  assert.equal(maintenance.plannedTargetDate, null);

  const unstarted = getReviewProgressMeta({ reviewStage: 4, nextReviewDate: "2026-08-21" }, "2026-08-20");
  assert.equal(unstarted.phase, "unstarted");
  assert.equal(unstarted.currentTargetDay, null);
});

test("timeline nodes expose completed, current, future and missed nodes", () => {
  const nodes = getTimelineNodes({
    reviewStage: 2,
    cycleStartedAt: "2026-08-20",
    nextReviewDate: "2026-08-25",
  }, "2026-08-24");
  assert.deepEqual(nodes.map(({ day, plannedDate, status }) => ({ day, plannedDate, status })), [
    { day: 1, plannedDate: "2026-08-20", status: "completed" },
    { day: 2, plannedDate: "2026-08-21", status: "completed" },
    { day: 4, plannedDate: "2026-08-23", status: "missed" },
    { day: 7, plannedDate: "2026-08-26", status: "future" },
    { day: 15, plannedDate: "2026-09-03", status: "future" },
    { day: 30, plannedDate: "2026-09-18", status: "future" },
  ]);

  assert.deepEqual(getTimelineNodes({ reviewStage: 6, cycleStartedAt: "2026-08-20" }, "2026-09-20")
    .map(({ status }) => status), ["completed", "completed", "completed", "completed", "completed", "completed"]);
});

test("normalizeProgress clamps stage through maintenance and preserves legacy cycle aliases", () => {
  const normalized = normalizeProgress({ reviewStage: 99, cycle_started_at: "2026-08-20" }, "item");
  assert.equal(normalized.reviewStage, 6);
  assert.equal(normalized.cycleStartedAt, "2026-08-20");
});

test("mastered questions never enter the daily queue", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const queue = buildDailyQueue(items, {
    a: { mastered: true, examFrequency: "high", nextReviewDate: "2026-08-01" },
    b: { mastered: false, examFrequency: "high", nextReviewDate: "2026-08-12" },
  }, "2026-08-12");
  assert.deepEqual(queue.map(({ item }) => item.id), ["b"]);
});

test("quadrants use explicit mastery and high/low frequency only", () => {
  assert.equal(quadrantFor({ mastered: false, examFrequency: "high" }), "blind");
  assert.equal(quadrantFor({ mastered: true, examFrequency: "high" }), "consolidation");
  assert.equal(quadrantFor({ mastered: false, examFrequency: "low" }), "potential");
  assert.equal(quadrantFor({ mastered: true, examFrequency: "low" }), "safe");
  assert.equal(quadrantFor({ mastered: false, examFrequency: "unknown" }), "unknown");
});

test("date arithmetic remains calendar based", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(stageTargetDay(0), null);
  assert.equal(stageTargetDay(6), 30);
});
