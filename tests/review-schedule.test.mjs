import assert from "node:assert/strict";
import test from "node:test";
import {
  EBBINGHAUS_DAYS,
  addDays,
  buildDailyQueue,
  buildTodayProgress,
  getReviewProgressMeta,
  getTimelineNodes,
  isIntakePending,
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
  const items = [{ id: "a", date: "2026-08-01" }, { id: "b", date: "2026-08-01" }];
  const queue = buildDailyQueue(items, {
    a: { mastered: true, examFrequency: "high", nextReviewDate: "2026-08-01" },
    b: { mastered: false, examFrequency: "high", nextReviewDate: "2026-08-12" },
  }, "2026-08-12");
  assert.deepEqual(queue.map(({ item }) => item.id), ["b"]);
});

test("new-question intake waits until the day after import and persists", () => {
  const today = "2026-08-30";
  const items = [
    { id: "today", date: "2026-08-30" },
    { id: "yesterday", date: "2026-08-29" },
    { id: "older", date: "2026-08-27" },
    { id: "started", date: "2026-08-29" },
    { id: "mastered", date: "2026-08-29" },
  ];
  const progress = {
    started: { cycleStartedAt: "2026-08-29", reviewStage: 1, nextReviewDate: today },
    mastered: { mastered: true, nextReviewDate: today },
  };
  assert.equal(isIntakePending(items[0], undefined, today), false);
  assert.equal(isIntakePending(items[1], undefined, today), true);
  assert.equal(isIntakePending(items[2], undefined, today), true);
  assert.equal(isIntakePending(items[3], progress.started, today), false);
  assert.equal(isIntakePending(items[4], progress.mastered, today), false);

  const queue = buildDailyQueue(items, progress, today);
  assert.deepEqual(queue.slice(0, 2).map(({ item, source }) => [item.id, source]), [
    ["yesterday", "intake"],
    ["older", "intake"],
  ]);
  assert.equal(queue.filter(({ item }) => item.id === "today").length, 0);
  assert.equal(queue.filter(({ item }) => item.id === "mastered").length, 0);
  assert.equal(queue.filter(({ item }) => item.id === "started").length, 1);
});

test("intake review results keep Day 1 semantics", () => {
  const base = { itemId: "new", masteryLevel: 0, reviewStage: 0, cycleStartedAt: null, nextReviewDate: "2026-08-30" };
  const hard = scheduleReview(base, "hard", "2026-08-30");
  const wrong = scheduleReview(base, "wrong", "2026-08-30");
  const correct = scheduleReview(base, "correct", "2026-08-30");
  assert.equal(hard.cycleStartedAt, null);
  assert.equal(wrong.cycleStartedAt, null);
  assert.equal(correct.cycleStartedAt, "2026-08-30");
  assert.equal(correct.reviewStage, 1);
});

test("intake queue deduplicates overlap with core and due", () => {
  const item = { id: "overlap", date: "2026-08-29" };
  const queue = buildDailyQueue([item], {
    overlap: { examFrequency: "high", nextReviewDate: "2026-08-30" },
  }, "2026-08-30");
  assert.equal(queue.filter(({ item: entry }) => entry.id === "overlap").length, 1);
  assert.equal(queue[0].source, "intake");
});

test("intake keeps history order for questions imported on the same day", () => {
  const items = [
    { id: "history-first", date: "2026-08-29" },
    { id: "history-second", date: "2026-08-29" },
  ];
  assert.deepEqual(
    buildDailyQueue(items, {}, "2026-08-30").map(({ item }) => item.id),
    ["history-first", "history-second"],
  );
});

test("due questions are ordered from the nearest overdue date to the oldest", () => {
  const items = [
    { id: "older-overdue", date: "2026-08-01" },
    { id: "recent-overdue", date: "2026-08-20" },
  ];
  const progress = {
    "older-overdue": { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: "2026-08-20", examFrequency: "medium" },
    "recent-overdue": { cycleStartedAt: "2026-08-20", reviewStage: 1, nextReviewDate: "2026-08-29", examFrequency: "medium" },
  };
  assert.deepEqual(
    buildDailyQueue(items, progress, "2026-08-30").map(({ item }) => item.id),
    ["recent-overdue", "older-overdue"],
  );
});

test("daily queue prioritizes due today, then overdue, then nearest future dates", () => {
  const today = "2026-08-30";
  const items = [
    { id: "future", date: "2026-08-01" },
    { id: "overdue", date: "2026-08-01" },
    { id: "today", date: "2026-08-01" },
  ];
  const progress = {
    future: { cycleStartedAt: "2026-08-01", reviewStage: 2, nextReviewDate: "2026-09-01", examFrequency: "high" },
    overdue: { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: "2026-08-29", examFrequency: "medium" },
    today: { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: today, examFrequency: "medium" },
  };
  assert.deepEqual(
    buildDailyQueue(items, progress, today).map(({ item }) => item.id),
    ["today", "overdue", "future"],
  );
});

test("daily queue keeps all today work first and orders each later tier by its schedule", () => {
  const today = "2026-08-30";
  const items = [
    { id: "intake-first", date: "2026-08-29" },
    { id: "intake-second", date: "2026-08-29" },
    { id: "today-due", date: "2026-08-01" },
    { id: "overdue-near", date: "2026-08-02" },
    { id: "overdue-far", date: "2026-08-03" },
    { id: "future-near", date: "2026-08-04" },
    { id: "future-far", date: "2026-08-05" },
  ];
  const progress = {
    "today-due": { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: today, examFrequency: "medium" },
    "overdue-near": { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: "2026-08-29", examFrequency: "medium" },
    "overdue-far": { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: "2026-08-20", examFrequency: "medium" },
    "future-near": { cycleStartedAt: "2026-08-01", reviewStage: 2, nextReviewDate: "2026-09-01", examFrequency: "high" },
    "future-far": { cycleStartedAt: "2026-08-01", reviewStage: 2, nextReviewDate: "2026-09-10", examFrequency: "high" },
  };

  assert.deepEqual(
    buildDailyQueue(items, progress, today).map(({ item }) => item.id),
    [
      "intake-first",
      "intake-second",
      "today-due",
      "overdue-near",
      "overdue-far",
      "future-near",
      "future-far",
    ],
  );
});

test("intake date comparisons cross month and year boundaries", () => {
  assert.equal(isIntakePending({ id: "month", date: "2026-08-31" }, {}, "2026-09-01"), true);
  assert.equal(isIntakePending({ id: "year", date: "2026-12-31" }, {}, "2027-01-01"), true);
  assert.equal(isIntakePending({ id: "same", date: "2027-01-01" }, {}, "2027-01-01"), false);
});

test("today progress counts unique formal reviews against a stable queue total", () => {
  const queue = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ item: { id } }));
  const today = "2026-08-30";
  assert.deepEqual(buildTodayProgress(queue, [], today), {
    completed: 0, total: 10, remaining: 10, isComplete: false,
  });
  assert.equal(buildTodayProgress(queue, [
    { itemId: "a", eventType: "review", result: "correct", occurredDate: today },
    { itemId: "b", eventType: "review", result: "hard", occurredDate: today },
    { itemId: "c", eventType: "review", result: "wrong", occurredDate: today },
  ], today).completed, 3);
});

test("today progress de-duplicates repeated results and excludes other dates", () => {
  const today = "2026-08-30";
  const queue = [{ item: { id: "a" } }, { item: { id: "b" } }];
  const progress = buildTodayProgress(queue, [
    { itemId: "a", eventType: "review", result: "hard", occurredDate: today },
    { itemId: "a", eventType: "review", result: "correct", occurredDate: today },
    { itemId: "b", eventType: "review", result: "wrong", occurredDate: "2026-08-29" },
  ], today);
  assert.deepEqual(progress, { completed: 1, total: 2, remaining: 1, isComplete: false });
});

test("today progress counts formal reviews that appeared after the initial queue snapshot", () => {
  const today = "2026-08-30";
  const progress = buildTodayProgress(
    [{ item: { id: "initial" } }],
    [
      { itemId: "initial", eventType: "review", result: "hard", occurredDate: today },
      { itemId: "later-1", eventType: "review", result: "wrong", occurredDate: today },
      { itemId: "later-2", eventType: "review", result: "correct", occurredDate: today },
    ],
    today,
    ["initial"],
  );
  assert.deepEqual(progress, { completed: 3, total: 3, remaining: 0, isComplete: true });
});

test("today progress includes completed questions after a queue refresh", () => {
  const today = "2026-08-30";
  const remainingQueue = ["r1", "r2", "r3", "r4"].map((id) => ({ item: { id } }));
  const completedEvents = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((itemId) => ({
    itemId,
    eventType: "review",
    result: "correct",
    occurredDate: today,
  }));

  assert.deepEqual(buildTodayProgress(remainingQueue, completedEvents, today), {
    completed: 8,
    total: 12,
    remaining: 4,
    isComplete: false,
  });
});

test("today queue denominator includes intake, excludes same-day imports and mastered items", () => {
  const today = "2026-08-30";
  const items = [
    { id: "intake", date: "2026-08-29" },
    { id: "same-day", date: today },
    { id: "mastered", date: "2026-08-29" },
    { id: "due", date: "2026-08-01" },
  ];
  const queue = buildDailyQueue(items, {
    mastered: { mastered: true, nextReviewDate: today },
    due: { cycleStartedAt: "2026-08-01", reviewStage: 1, nextReviewDate: today },
  }, today);
  const ids = queue.map(({ item }) => item.id);
  assert.equal(ids.includes("intake"), true);
  assert.equal(ids.includes("same-day"), false);
  assert.equal(ids.includes("mastered"), false);
  assert.equal(buildTodayProgress(queue, [], today).total, 2);
});

test("today progress handles completion, empty queues and a new day", () => {
  const queue = [{ item: { id: "a" } }, { item: { id: "b" } }];
  const today = "2026-08-30";
  const events = [
    { itemId: "a", eventType: "review", result: "correct", occurredDate: today },
    { itemId: "b", eventType: "master", result: null, occurredDate: today },
  ];
  assert.deepEqual(buildTodayProgress(queue, events, today), {
    completed: 2, total: 2, remaining: 0, isComplete: true,
  });
  assert.deepEqual(buildTodayProgress([], [], today), {
    completed: 0, total: 0, remaining: 0, isComplete: false,
  });
  assert.equal(buildTodayProgress(queue, events, "2026-08-31").completed, 0);
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
