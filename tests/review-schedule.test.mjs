import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  buildDailyQueue,
  quadrantFor,
  scheduleReview,
} from "../lib/review-schedule.mjs";

test("correct reviews advance through the Ebbinghaus intervals", () => {
  const first = scheduleReview({ masteryLevel: 0, reviewStage: 0 }, "correct", "2026-08-12");
  assert.equal(first.masteryLevel, 1);
  assert.equal(first.reviewStage, 1);
  assert.equal(first.nextReviewDate, "2026-08-13");

  const final = scheduleReview({ masteryLevel: 5, reviewStage: 5 }, "correct", "2026-08-12");
  assert.equal(final.masteryLevel, 5);
  assert.equal(final.reviewStage, 5);
  assert.equal(final.nextReviewDate, "2026-09-11");
});

test("wrong reviews lower mastery and restart the schedule", () => {
  const result = scheduleReview({ masteryLevel: 3, reviewStage: 4 }, "wrong", "2026-08-12");
  assert.deepEqual(result, {
    masteryLevel: 2,
    reviewStage: 0,
    nextReviewDate: "2026-08-13",
    lastResult: "wrong",
  });
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
});
