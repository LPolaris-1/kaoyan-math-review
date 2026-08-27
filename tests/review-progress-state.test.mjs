import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewAction } from "../lib/review-progress-state.mjs";

const baseProgress = {
  itemId: "item-1",
  masteryLevel: 2,
  examFrequency: "high",
  reviewStage: 2,
  nextReviewDate: "2026-08-23",
  cycleStartedAt: "2026-08-20",
  mastered: 0,
  lastReviewedAt: "2026-08-21T00:00:00.000Z",
  lastResult: "correct",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

test("review action uses scheduleReview and records the before/after cycle state", () => {
  const { changes, event } = buildReviewAction({
    base: baseProgress,
    action: "review",
    result: "correct",
    today: "2026-08-23",
    now: "2026-08-23T01:00:00.000Z",
  });
  assert.equal(changes.reviewStage, 3);
  assert.equal(changes.nextReviewDate, "2026-08-26");
  assert.equal(changes.cycleStartedAt, "2026-08-20");
  assert.deepEqual(event, {
    eventType: "review",
    result: "correct",
    occurredAt: "2026-08-23T01:00:00.000Z",
    occurredDate: "2026-08-23",
    cycleStartedAt: "2026-08-20",
    targetDay: 4,
    scheduledDate: "2026-08-23",
    reviewStageBefore: 2,
    reviewStageAfter: 3,
    createdAt: "2026-08-23T01:00:00.000Z",
  });
});

test("wrong clears the active cycle, while the event retains the old anchor", () => {
  const { changes, event } = buildReviewAction({
    base: baseProgress,
    action: "review",
    result: "wrong",
    today: "2026-08-24",
    now: "2026-08-24T01:00:00.000Z",
  });
  assert.equal(changes.reviewStage, 0);
  assert.equal(changes.cycleStartedAt, null);
  assert.equal(changes.nextReviewDate, "2026-08-25");
  assert.equal(event.cycleStartedAt, "2026-08-20");
  assert.equal(event.reviewStageAfter, 0);

  const restarted = buildReviewAction({
    base: { ...baseProgress, ...changes },
    action: "review",
    result: "correct",
    today: "2026-08-25",
    now: "2026-08-25T01:00:00.000Z",
  });
  assert.equal(restarted.changes.cycleStartedAt, "2026-08-25");
  assert.equal(restarted.changes.reviewStage, 1);
});

test("hard preserves Day 1 and stage while creating a reinforcement event", () => {
  const { changes, event } = buildReviewAction({
    base: baseProgress,
    action: "review",
    result: "hard",
    today: "2026-08-24",
    now: "2026-08-24T01:00:00.000Z",
  });
  assert.equal(changes.cycleStartedAt, "2026-08-20");
  assert.equal(changes.reviewStage, 2);
  assert.equal(changes.nextReviewDate, "2026-08-25");
  assert.equal(event.targetDay, 4);
  assert.equal(event.scheduledDate, "2026-08-23");
});

test("setCycleStart accepts a historical Day 1 and recalculates the current target", () => {
  const { changes, event } = buildReviewAction({
    base: baseProgress,
    action: "setCycleStart",
    cycleStartedAt: "2026-08-10",
    today: "2026-08-24",
    now: "2026-08-24T02:00:00.000Z",
  });
  assert.equal(changes.cycleStartedAt, "2026-08-10");
  assert.equal(changes.reviewStage, 2);
  assert.equal(changes.nextReviewDate, "2026-08-13");
  assert.equal(event.eventType, "set_cycle_start");
  assert.equal(event.cycleStartedAt, "2026-08-10");
  assert.equal(event.targetDay, 4);
  assert.equal(event.scheduledDate, "2026-08-13");
});

test("master/unmaster remain compatible and frequency changes do not create review events", () => {
  const mastered = buildReviewAction({
    base: baseProgress,
    action: "master",
    today: "2026-08-24",
    now: "2026-08-24T03:00:00.000Z",
  });
  assert.equal(mastered.changes.mastered, 1);
  assert.equal(mastered.event.eventType, "master");

  const unmastered = buildReviewAction({
    base: { ...baseProgress, mastered: 1 },
    action: "unmaster",
    today: "2026-08-24",
    now: "2026-08-24T03:00:00.000Z",
  });
  assert.equal(unmastered.changes.mastered, 0);
  assert.equal(unmastered.event.eventType, "unmaster");

  const frequency = buildReviewAction({
    base: baseProgress,
    action: "setFrequency",
    frequency: "low",
    today: "2026-08-24",
    now: "2026-08-24T03:00:00.000Z",
  });
  assert.equal(frequency.changes.examFrequency, "low");
  assert.equal(frequency.event, null);
});
