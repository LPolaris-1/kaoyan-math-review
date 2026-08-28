const VALID_VIEWS = new Set(["today", "progress", "overview", "matrix", "mastered"]);
const VALID_RANGES = new Set([7, 30, 60]);
const VALID_QUADRANTS = new Set(["blind", "potential", "consolidation", "safe"]);

export const DEFAULT_REVIEW_QUERY = Object.freeze({
  view: "today",
  range: 30,
  quadrants: [],
  date: null,
  itemId: null,
  focus: null,
});

export function parseReviewQuery(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input ?? "");
  const view = VALID_VIEWS.has(params.get("view")) ? params.get("view") : DEFAULT_REVIEW_QUERY.view;
  const parsedRange = Number(params.get("range"));
  const range = VALID_RANGES.has(parsedRange) ? parsedRange : DEFAULT_REVIEW_QUERY.range;
  const quadrants = Array.from(new Set((params.get("quadrants") ?? "")
    .split(",")
    .filter((value) => VALID_QUADRANTS.has(value))));
  const date = isDate(params.get("date")) ? params.get("date") : null;
  const itemId = cleanValue(params.get("item"));
  const focus = ["due", "overdue", "unstarted"].includes(params.get("focus")) ? params.get("focus") : null;
  return { view, range, quadrants, date, itemId, focus };
}

export function serializeReviewQuery(state) {
  const params = new URLSearchParams();
  if (state.view && state.view !== DEFAULT_REVIEW_QUERY.view) params.set("view", state.view);
  if (state.range && state.range !== DEFAULT_REVIEW_QUERY.range) params.set("range", String(state.range));
  if (state.quadrants?.length) params.set("quadrants", state.quadrants.join(","));
  if (state.date && isDate(state.date)) params.set("date", state.date);
  if (state.itemId) params.set("item", state.itemId);
  if (state.focus) params.set("focus", state.focus);
  return params.toString();
}

export function toggleQuadrant(quadrants, key) {
  const current = new Set(quadrants);
  if (current.has(key)) current.delete(key);
  else if (VALID_QUADRANTS.has(key)) current.add(key);
  return Array.from(current).filter((value) => VALID_QUADRANTS.has(value));
}

export function filterByQuadrants(entries, quadrants) {
  if (!quadrants?.length) return entries;
  const selected = new Set(quadrants);
  return entries.filter(({ progress }) => selected.has(quadrantForProgress(progress)));
}

function quadrantForProgress(progress) {
  const frequency = progress?.examFrequency ?? "unknown";
  const mastered = Boolean(progress?.mastered);
  if (frequency === "high") return mastered ? "consolidation" : "blind";
  if (frequency === "low") return mastered ? "safe" : "potential";
  return null;
}

function cleanValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
