import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_URL, loadHistory } from "../lib/history-loader.mjs";

const history = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  totalNotes: 1,
  totalDays: 1,
  days: [{
    date: "2026-10-22",
    count: 1,
    subjectCounts: { 高数: 1 },
    topics: ["极限"],
    takeaways: ["检查条件"],
    summary: "1 道题",
    items: [{
      id: "one", title: "数列极限", subject: "高数", chapter: "极限", topic: "数列极限",
      content: "题目", sourcePath: "原档案/one.md", methods: [], keyPoints: [], pitfalls: [], isPastExam: false,
    }],
  }],
};

test("history loader accepts valid data and uses the stable URL with browser cache validation", async () => {
  let request;
  const result = await loadHistory((url, options) => {
    request = { url, options };
    return Promise.resolve({ ok: true, status: 200, json: async () => history });
  });
  assert.equal(result, history);
  assert.equal(request.url, HISTORY_URL);
  assert.equal(request.url, "/data/history.json");
  assert.equal("cache" in request.options, false);
  assert.equal(request.options.signal.aborted, false);
});

test("history loader identifies authentication and other HTTP failures", async () => {
  await assert.rejects(loadHistory(async () => ({ ok: false, status: 401 })), /重新登录/);
  await assert.rejects(loadHistory(async () => ({ ok: false, status: 503 })), /HTTP 503/);
});

test("history loader rejects broken JSON and missing render fields", async () => {
  await assert.rejects(loadHistory(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end"); } })), /响应无效或不完整/);
  await assert.rejects(loadHistory(async () => ({ ok: true, status: 200, json: async () => ({ days: [] }) })), /数据结构无效/);
  await assert.rejects(loadHistory(async () => ({ ok: true, status: 200, json: async () => ({ ...history, days: [{ ...history.days[0], items: [{ id: "one" }] }] }) })), /数据结构无效/);
});

test("history loader reports network rejection and times out a hanging request", async () => {
  await assert.rejects(loadHistory(async () => { throw new TypeError("Failed to fetch"); }), /检查网络/);
  let signal;
  await assert.rejects(loadHistory((_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }, 10), /加载超时/);
  assert.equal(signal.aborted, true);
  await assert.rejects(loadHistory(async () => ({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  }), 10), /加载超时/);
});

test("a retry can succeed after an initial failure", async () => {
  let attempts = 0;
  const fetcher = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("offline");
    return { ok: true, status: 200, json: async () => history };
  };
  await assert.rejects(loadHistory(fetcher), /检查网络/);
  assert.equal(await loadHistory(fetcher), history);
  assert.equal(attempts, 2);
});
