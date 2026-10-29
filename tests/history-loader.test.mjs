import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_DAYS_DIR,
  HISTORY_INDEX_URL,
  HISTORY_RETRY_DELAY_MS,
  HISTORY_TIMEOUT_MS,
  HISTORY_URL,
  loadHistory,
  loadHistoryDay,
} from "../lib/history-loader.mjs";

const index = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  totalNotes: 2,
  totalDays: 2,
  days: [
    {
      date: "2026-10-22",
      count: 1,
      subjectCounts: { 高数: 1 },
      topics: ["极限"],
      takeaways: ["检查条件"],
      summary: "1 道题",
      items: [{
        id: "one", date: "2026-10-22", title: "数列极限", titleMarkdown: "数列极限", subject: "高数",
        chapter: "极限", topic: "数列极限", methods: ["等价无穷小"], question: "求极限", keyPoints: [],
        pitfalls: [], answer: "1", sourcePath: "原档案/one.md", isPastExam: false,
      }],
    },
    {
      date: "2026-10-23",
      count: 1,
      subjectCounts: { 线代: 1 },
      topics: ["秩"],
      takeaways: ["看列空间"],
      summary: "1 道题",
      items: [{
        id: "two", date: "2026-10-23", title: "秩", titleMarkdown: "秩", subject: "线代",
        chapter: "矩阵", topic: "秩", methods: ["初等变换"], question: "求秩", keyPoints: [],
        pitfalls: [], answer: "2", sourcePath: "原档案/two.md", isPastExam: true,
      }],
    },
  ],
};

const day = {
  date: "2026-10-22",
  items: [{ id: "one", content: "# 原题\n\n$x^2$" }],
};

function ok(data, status = 200) {
  return { ok: true, status, json: async () => data };
}

function failure(status) {
  return { ok: false, status, json: async () => ({}) };
}

test("history loader uses the metadata index URL and preserves a 60 second default", async () => {
  let request;
  const result = await loadHistory((url, options) => {
    request = { url, options };
    return Promise.resolve(ok(index));
  });
  assert.equal(result, index);
  assert.equal(HISTORY_URL, "/data/history.json");
  assert.equal(HISTORY_INDEX_URL, "/data/history-index.json");
  assert.equal(HISTORY_TIMEOUT_MS, 60_000);
  assert.equal(HISTORY_RETRY_DELAY_MS, 500);
  assert.equal(request.url, HISTORY_INDEX_URL);
  assert.equal("cache" in request.options, false);
  assert.equal(request.options.signal.aborted, false);
});

test("history loader retries once after a 5xx response", async () => {
  let attempts = 0;
  const result = await loadHistory(async () => {
    attempts += 1;
    return attempts === 1 ? failure(503) : ok(index);
  }, 1_000, 0);
  assert.equal(result, index);
  assert.equal(attempts, 2);
});

test("history loader retries once after a network failure", async () => {
  let attempts = 0;
  const result = await loadHistory(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("Failed to fetch");
    return ok(index);
  }, 1_000, 0);
  assert.equal(result, index);
  assert.equal(attempts, 2);
});

test("history loader reports consecutive 5xx failures after exactly one retry", async () => {
  let attempts = 0;
  await assert.rejects(loadHistory(async () => {
    attempts += 1;
    return failure(503);
  }, 1_000, 0), /HTTP 503/);
  assert.equal(attempts, 2);
});

test("authentication, forbidden and not-found responses never retry", async () => {
  for (const [status, pattern] of [[401, /重新登录/], [403, /没有权限/], [404, /HTTP 404/]]) {
    let attempts = 0;
    await assert.rejects(loadHistory(async () => {
      attempts += 1;
      return failure(status);
    }, 1_000, 0), pattern);
    assert.equal(attempts, 1);
  }
});

test("each timeout attempt aborts its own controller", async () => {
  const signals = [];
  await assert.rejects(loadHistory((_, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  }, 10, 0), /加载超时/);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals.every((signal) => signal.aborted), true);
});

test("a hanging JSON body is aborted by the attempt timeout", async () => {
  let signal;
  await assert.rejects(loadHistory((_, options) => {
    signal = options.signal;
    return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
  }, 10, 0), /加载超时/);
  assert.equal(signal.aborted, true);
});

test("truncated JSON retries once; schema failures do not retry", async () => {
  let truncatedAttempts = 0;
  const result = await loadHistory(async () => {
    truncatedAttempts += 1;
    if (truncatedAttempts === 1) {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } };
    }
    return ok(index);
  }, 1_000, 0);
  assert.equal(result, index);
  assert.equal(truncatedAttempts, 2);

  await assert.rejects(loadHistory(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
  }), 1_000, 0), /响应不完整/);

  let schemaAttempts = 0;
  await assert.rejects(loadHistory(async () => {
    schemaAttempts += 1;
    return ok({ ...index, days: [{ ...index.days[0], items: [{ id: "missing-fields" }] }] });
  }, 1_000, 0), /数据结构无效/);
  assert.equal(schemaAttempts, 1);
});

test("history day loader deduplicates concurrent and later requests through the day cache", async () => {
  let attempts = 0;
  const fetcher = async () => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return ok(day);
  };
  const first = loadHistoryDay(day.date, fetcher, 1_000, 0);
  const second = loadHistoryDay(day.date, fetcher, 1_000, 0);
  assert.equal(first, second);
  assert.deepEqual(await first, day);
  assert.deepEqual(await loadHistoryDay(day.date, fetcher, 1_000, 0), day);
  assert.equal(attempts, 1);
});

test("history day loader removes failed cache entries so retry can fetch again", async () => {
  const date = "2031-12-31";
  let attempts = 0;
  await assert.rejects(loadHistoryDay(date, async (url) => {
    attempts += 1;
    assert.equal(url, `${HISTORY_DAYS_DIR}/${date}.json`);
    return failure(401);
  }, 1_000, 0), /重新登录/);
  assert.equal(attempts, 1);

  const result = await loadHistoryDay(date, async (url) => {
    attempts += 1;
    assert.equal(url, `${HISTORY_DAYS_DIR}/${date}.json`);
    return ok({ date, items: [{ id: "retry", content: "ok" }] });
  }, 1_000, 0);
  assert.deepEqual(result, { date, items: [{ id: "retry", content: "ok" }] });
  assert.equal(attempts, 2);
});

test("history day loader rejects schema-invalid shards without retrying", async () => {
  let attempts = 0;
  await assert.rejects(loadHistoryDay("2031-12-30", async () => {
    attempts += 1;
    return ok({ date: "2031-12-30", items: [{ id: "duplicate", content: "a" }, { id: "duplicate", content: "b" }] });
  }, 1_000, 0), /数据无效/);
  assert.equal(attempts, 1);
});
