import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  filterByQuadrants,
  parseReviewQuery,
  serializeReviewQuery,
  toggleQuadrant,
} from "../lib/review-navigation.mjs";

test("review query omits defaults and round-trips supported URL state", () => {
  const query = {
    view: "overview",
    range: 60,
    quadrants: ["blind", "potential"],
    date: "2026-08-28",
    itemId: "二重积分交换积分次序",
    focus: null,
  };
  const encoded = serializeReviewQuery(query);
  assert.equal(encoded, "view=overview&range=60&quadrants=blind%2Cpotential&date=2026-08-28&item=%E4%BA%8C%E9%87%8D%E7%A7%AF%E5%88%86%E4%BA%A4%E6%8D%A2%E7%A7%AF%E5%88%86%E6%AC%A1%E5%BA%8F");
  assert.deepEqual(parseReviewQuery(encoded), query);
  assert.equal(serializeReviewQuery({ view: "today", range: 30, quadrants: [], date: null, itemId: null, focus: null }), "");
});

test("review query rejects invalid dates, views, ranges and focus values", () => {
  assert.deepEqual(parseReviewQuery("view=wat&range=9&date=2026-02-30&focus=other&quadrants=blind,wat"), {
    view: "today",
    range: 30,
    quadrants: ["blind"],
    date: null,
    itemId: null,
    focus: null,
  });
});

test("quadrant toggles are deterministic and use OR semantics", () => {
  assert.deepEqual(toggleQuadrant([], "blind"), ["blind"]);
  assert.deepEqual(toggleQuadrant(["blind"], "potential"), ["blind", "potential"]);
  assert.deepEqual(toggleQuadrant(["blind", "potential"], "blind"), ["potential"]);
  const entries = [
    { item: { id: "blind" }, progress: { examFrequency: "high", mastered: false } },
    { item: { id: "potential" }, progress: { examFrequency: "low", mastered: false } },
    { item: { id: "safe" }, progress: { examFrequency: "low", mastered: true } },
  ];
  assert.deepEqual(filterByQuadrants(entries, ["blind", "safe"]).map(({ item }) => item.id), ["blind", "safe"]);
});

test("review UI owns navigation in the URL and exposes deep-link actions", async () => {
  const page = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
  const overview = await readFile(new URL("../app/components/review/review-overview.tsx", import.meta.url), "utf8");
  const progress = await readFile(new URL("../app/components/review/progress-overview.tsx", import.meta.url), "utf8");
  assert.match(page, /parseReviewQuery/);
  assert.match(page, /pushState/);
  assert.match(page, /replaceState/);
  assert.match(page, /popstate/);
  assert.match(page, /fetch\("\/data\/history\.json"\)/);
  assert.match(overview, /toggleQuadrant/);
  assert.match(overview, /onKpiNavigate/);
  assert.match(overview, /onViewProgress/);
  assert.match(progress, /onViewOverview/);
  assert.match(progress, /progress-item-/);
});
