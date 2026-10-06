import assert from "node:assert/strict";
import test from "node:test";
import {
  OVERVIEW_RANGES,
  buildDailyReviewLoad,
  buildQuadrantEntries,
  calculateReviewSummary,
  groupByScheduleDay,
  groupOverdue,
  groupReviewsByDate,
} from "../lib/review-overview.mjs";

const today = "2026-08-27";

function entry(id, overrides = {}) {
  const { itemDate, ...progressOverrides } = overrides;
  return {
    item: { id, title: id, date: itemDate ?? "2026-08-20" },
    progress: {
      itemId: id,
      masteryLevel: 1,
      examFrequency: "high",
      reviewStage: 1,
      nextReviewDate: today,
      mastered: false,
      cycleStartedAt: "2026-08-26",
      lastReviewedAt: null,
      lastResult: null,
      ...progressOverrides,
    },
  };
}

function reviewEvent(itemId, overrides = {}) {
  return {
    itemId,
    eventType: "review",
    result: "correct",
    occurredDate: today,
    scheduledDate: today,
    reviewStageBefore: 1,
    ...overrides,
  };
}

test("daily load includes yesterday intake, due work, and unfinished intake from the last ten days", () => {
  const entries = [
    entry("yesterday", { itemDate: "2026-08-26", cycleStartedAt: null, reviewStage: 0 }),
    entry("due", { itemDate: "2026-08-01" }),
    entry("overdue", { itemDate: "2026-08-01", nextReviewDate: "2026-08-26" }),
    entry("catchup", { itemDate: "2026-08-20", cycleStartedAt: null, reviewStage: 0 }),
    entry("too-old", { itemDate: "2026-08-16", cycleStartedAt: null, reviewStage: 0 }),
    entry("today-import", { itemDate: today, cycleStartedAt: null, reviewStage: 0 }),
  ];
  const load = buildDailyReviewLoad(entries, [], today);
  assert.deepEqual(load.groups.map(({ key, total }) => [key, total]), [
    ["yesterday", 1],
    ["due", 2],
    ["catchup", 1],
  ]);
  assert.equal(load.total, 4);
  assert.equal(load.completed, 0);
  assert.equal(load.remaining, 4);
  assert.equal(load.catchup.total, 1);
});

test("daily load keeps a stable denominator after formal review and deduplicates categories", () => {
  const entries = [
    entry("yesterday-done", {
      itemDate: "2026-08-26",
      cycleStartedAt: today,
      reviewStage: 1,
      nextReviewDate: "2026-08-30",
      lastReviewedAt: `${today}T02:00:00.000Z`,
      lastResult: "correct",
    }),
    entry("catchup-done", {
      itemDate: "2026-08-20",
      cycleStartedAt: today,
      reviewStage: 1,
      nextReviewDate: "2026-08-30",
      lastReviewedAt: `${today}T02:10:00.000Z`,
      lastResult: "correct",
    }),
    entry("due-done", {
      itemDate: "2026-08-01",
      reviewStage: 2,
      nextReviewDate: "2026-08-30",
      lastReviewedAt: `${today}T02:20:00.000Z`,
      lastResult: "correct",
    }),
  ];
  const events = [
    reviewEvent("yesterday-done", { reviewStageBefore: 0 }),
    reviewEvent("catchup-done", { reviewStageBefore: 0 }),
    reviewEvent("catchup-done", { result: "hard", reviewStageBefore: 0 }),
    reviewEvent("due-done", { scheduledDate: today, reviewStageBefore: 1 }),
  ];
  const load = buildDailyReviewLoad(entries, events, today);
  assert.deepEqual(load.groups.map(({ key, total, completed }) => [key, total, completed]), [
    ["yesterday", 1, 1],
    ["due", 1, 1],
    ["catchup", 1, 1],
  ]);
  assert.equal(load.total, 3);
  assert.equal(load.completed, 3);
  assert.equal(load.remaining, 0);
  assert.deepEqual(load.catchup, { total: 1, completed: 1, remaining: 0 });
});

test("daily load excludes mastered and future-only work while preserving completed-today items", () => {
  const entries = [
    entry("mastered-old", { itemDate: "2026-08-20", cycleStartedAt: null, reviewStage: 0, mastered: true }),
    entry("future", { itemDate: "2026-08-01", nextReviewDate: "2026-09-02" }),
    entry("mastered-today", { itemDate: "2026-08-20", cycleStartedAt: null, reviewStage: 0, mastered: true }),
  ];
  const load = buildDailyReviewLoad(entries, [
    { itemId: "mastered-today", eventType: "master", occurredDate: today, reviewStageBefore: 0 },
  ], today);
  assert.equal(load.total, 1);
  assert.equal(load.completed, 1);
  assert.equal(load.groups.find(({ key }) => key === "catchup")?.total, 1);
});

test("overview summary separates due, overdue, future windows, and unstarted", () => {
  const entries = [
    entry("due"),
    entry("overdue", { nextReviewDate: "2026-08-25" }),
    entry("future7", { nextReviewDate: "2026-09-02" }),
    entry("future30", { nextReviewDate: "2026-09-20" }),
    entry("outside", { nextReviewDate: "2026-10-01" }),
    entry("invalid", { nextReviewDate: "not-a-date" }),
    entry("unstarted", { cycleStartedAt: null, reviewStage: 0 }),
    entry("mastered", { mastered: true, nextReviewDate: "2026-08-27" }),
  ];
  assert.deepEqual(calculateReviewSummary(entries, today), {
    dueToday: 1,
    overdue: 1,
    future7: 1,
    future30: 2,
    unstarted: 1,
  });
});

test("timeline ranges are 7, 30, and 60 days and exclude overdue/mastered/unstarted", () => {
  assert.deepEqual(OVERVIEW_RANGES, [7, 30, 60]);
  const entries = [
    entry("day1", { nextReviewDate: today }),
    entry("day7", { nextReviewDate: "2026-09-02", reviewStage: 2 }),
    entry("day30", { nextReviewDate: "2026-09-25", reviewStage: 3 }),
    entry("day60", { nextReviewDate: "2026-10-25", reviewStage: 4 }),
    entry("overdue", { nextReviewDate: "2026-08-26" }),
    entry("mastered", { mastered: true, nextReviewDate: "2026-09-01" }),
    entry("unstarted", { cycleStartedAt: null, reviewStage: 0, nextReviewDate: "2026-09-01" }),
  ];
  assert.deepEqual(groupReviewsByDate(entries, today, 7).map((group) => group.date), [today, "2026-09-02"]);
  assert.deepEqual(groupReviewsByDate(entries, today, 30).map((group) => group.date), [today, "2026-09-02", "2026-09-25"]);
  assert.deepEqual(groupReviewsByDate(entries, today, 60).map((group) => group.date), [today, "2026-09-02", "2026-09-25", "2026-10-25"]);
});

test("date groups expose Ebbinghaus schedule labels and stable item order", () => {
  const entries = [
    entry("z", { nextReviewDate: "2026-08-28", reviewStage: 1 }),
    entry("a", { nextReviewDate: "2026-08-28", reviewStage: 2 }),
  ];
  const [group] = groupReviewsByDate(entries, today, 7);
  assert.equal(group.count, 2);
  assert.deepEqual(group.entries.map(({ item }) => item.id), ["a", "z"]);
  assert.deepEqual(groupByScheduleDay(group.entries).map(({ label, entries: grouped }) => [label, grouped.length]), [["Day 7", 1], ["Day 4", 1]]);
});

test("overdue stays separate and retains original date and current stage", () => {
  const overdue = groupOverdue([
    entry("late", { nextReviewDate: "2026-08-24", reviewStage: 3 }),
    entry("mastered", { mastered: true, nextReviewDate: "2026-08-24" }),
    entry("unstarted", { cycleStartedAt: null, reviewStage: 0, nextReviewDate: "2026-08-24" }),
  ], today);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].progress.nextReviewDate, "2026-08-24");
  assert.equal(overdue[0].meta.overdueDays, 3);
  assert.equal(overdue[0].scheduleDay, "Day 30");
});

test("invalid schedule dates are excluded from timeline and overdue views", () => {
  const entries = [entry("invalid", { nextReviewDate: "2026-99-99" })];
  assert.deepEqual(groupReviewsByDate(entries, today, 60), []);
  assert.deepEqual(groupOverdue(entries, today), []);
});

test("quadrant filter is client-derived and cannot duplicate entries", () => {
  const entries = [
    entry("blind", { examFrequency: "high" }),
    entry("potential", { examFrequency: "low" }),
    entry("consolidation", { mastered: true, examFrequency: "high" }),
    entry("safe", { mastered: true, examFrequency: "low" }),
  ];
  assert.equal(buildQuadrantEntries(entries, "blind").length, 1);
  assert.equal(buildQuadrantEntries(entries, "all").length, entries.length);
  assert.equal(new Set(buildQuadrantEntries(entries, "all").map(({ item }) => item.id)).size, entries.length);
});
