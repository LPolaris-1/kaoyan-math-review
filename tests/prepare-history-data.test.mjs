import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  findDerivedArtifactIssues,
  prepareHistoryData,
  verifyDerivedArtifacts,
} from "../scripts/prepare-history-data.mjs";

const history = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  source: "06-Resources/学习/考研/考研数学/错题本/原档案",
  totalNotes: 3,
  totalDays: 2,
  days: [
    {
      date: "2026-10-22",
      count: 2,
      subjectCounts: { 高数: 2 },
      topics: ["极限", "积分"],
      takeaways: ["先检查条件"],
      summary: "2 道题",
      items: [
        {
          id: "高数/one.md",
          date: "2026-10-22",
          titleMarkdown: "数列极限",
          title: "数列极限",
          subject: "高数",
          chapter: "极限",
          topic: "数列极限",
          methods: ["等价无穷小"],
          question: "求 $\\lim x_n$",
          keyPoints: ["单调有界"],
          pitfalls: ["漏掉前提"],
          answer: "$1$",
          content: "# 原题\n\n求 $\\lim_{n\\to\\infty} x_n$。\n\n答案：$1$。\n",
          tags: ["极限"],
          sourcePath: "高数/one.md",
          isPastExam: false,
        },
        {
          id: "高数/two.md",
          date: "2026-10-22",
          titleMarkdown: "定积分",
          title: "定积分",
          subject: "高数",
          chapter: "积分",
          topic: "积分",
          methods: ["换元"],
          question: "求积分",
          keyPoints: [],
          pitfalls: [],
          answer: "2",
          content: "# 定积分\n\n中文内容与 emoji：✅\n",
          tags: [],
          sourcePath: "高数/two.md",
          isPastExam: true,
        },
      ],
    },
    {
      date: "2026-10-23",
      count: 1,
      subjectCounts: { 线代: 1 },
      topics: ["秩"],
      takeaways: ["看列空间"],
      summary: "1 道题",
      items: [{
        id: "线代/three.md",
        date: "2026-10-23",
        titleMarkdown: "秩",
        title: "秩",
        subject: "线代",
        chapter: "矩阵",
        topic: "秩",
        methods: ["初等变换"],
        question: "求秩",
        keyPoints: ["行秩等于列秩"],
        pitfalls: [],
        answer: "2",
        content: "# 秩\n\n$$A = \\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}$$\n",
        tags: ["矩阵"],
        sourcePath: "线代/three.md",
        isPastExam: true,
      }],
    },
  ],
};

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-derived-"));
  const historyPath = path.join(dir, "history.json");
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  return { dir, historyPath };
}

function snapshot(dir) {
  const result = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".history-")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) result.set(path.relative(dir, absolute).replaceAll(path.sep, "/"), fs.readFileSync(absolute));
    }
  };
  walk(dir);
  return result;
}

test("derived history generator is deterministic and complete", () => {
  const first = makeFixture();
  const second = makeFixture();
  try {
    assert.equal(prepareHistoryData({ dataDir: first.dir, historyPath: first.historyPath }).changed, true);
    assert.equal(prepareHistoryData({ dataDir: second.dir, historyPath: second.historyPath }).changed, true);
    assert.deepEqual(snapshot(first.dir), snapshot(second.dir));

    const index = JSON.parse(fs.readFileSync(path.join(first.dir, "history-index.json"), "utf8"));
    assert.equal(index.totalNotes, history.totalNotes);
    assert.deepEqual(index.days.map((day) => day.date), history.days.map((day) => day.date));
    for (const [dayIndex, day] of index.days.entries()) {
      assert.equal(day.count, history.days[dayIndex].count);
      assert.deepEqual(day.subjectCounts, history.days[dayIndex].subjectCounts);
      assert.deepEqual(day.topics, history.days[dayIndex].topics);
      assert.deepEqual(day.takeaways, history.days[dayIndex].takeaways);
      assert.equal(day.summary, history.days[dayIndex].summary);
      assert.equal(day.items.length, history.days[dayIndex].items.length);
      assert.equal(day.items.some((item) => Object.hasOwn(item, "content")), false);
      for (const [itemIndex, item] of day.items.entries()) {
        const metadata = { ...history.days[dayIndex].items[itemIndex] };
        delete metadata.content;
        assert.deepEqual(item, metadata);
      }
    }

    for (const day of history.days) {
      const shardPath = path.join(first.dir, "history-days", `${day.date}.json`);
      const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
      assert.deepEqual(shard, {
        date: day.date,
        items: day.items.map((item) => ({ id: item.id, content: item.content })),
      });
      for (const suffix of [".br", ".gz"]) {
        const compressed = fs.readFileSync(`${shardPath}${suffix}`);
        const plain = suffix === ".br" ? zlib.brotliDecompressSync(compressed) : zlib.gunzipSync(compressed);
        assert.deepEqual(plain, fs.readFileSync(shardPath));
      }
    }
    for (const suffix of [".br", ".gz"]) {
      const compressed = fs.readFileSync(path.join(first.dir, `history.json${suffix}`));
      const plain = suffix === ".br" ? zlib.brotliDecompressSync(compressed) : zlib.gunzipSync(compressed);
      assert.deepEqual(plain, fs.readFileSync(first.historyPath));
    }

    assert.deepEqual(findDerivedArtifactIssues(history, first.dir), []);
    assert.deepEqual(verifyDerivedArtifacts(history, first.dir), { days: 2, items: 3 });
  } finally {
    fs.rmSync(first.dir, { recursive: true, force: true });
    fs.rmSync(second.dir, { recursive: true, force: true });
  }
});

test("derived history generator clears stale day shards and repairs corrupted variants", () => {
  const fixture = makeFixture();
  try {
    prepareHistoryData({ dataDir: fixture.dir, historyPath: fixture.historyPath });
    const stalePath = path.join(fixture.dir, "history-days", "2020-01-01.json");
    fs.writeFileSync(stalePath, "{\"date\":\"2020-01-01\",\"items\":[]}\n");
    fs.writeFileSync(`${stalePath}.br`, "stale");
    fs.writeFileSync(path.join(fixture.dir, "history-index.json.gz"), "corrupt");

    assert.ok(findDerivedArtifactIssues(history, fixture.dir).length > 0);
    assert.equal(prepareHistoryData({ dataDir: fixture.dir, historyPath: fixture.historyPath }).changed, true);
    assert.equal(fs.existsSync(stalePath), false);
    assert.equal(fs.existsSync(`${stalePath}.br`), false);
    assert.deepEqual(findDerivedArtifactIssues(history, fixture.dir), []);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("failed regeneration leaves the previous valid derived artifacts intact", () => {
  const fixture = makeFixture();
  try {
    prepareHistoryData({ dataDir: fixture.dir, historyPath: fixture.historyPath });
    const before = snapshot(fixture.dir);
    const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-invalid-"));
    const invalidHistoryPath = path.join(invalidDir, "invalid-history.json");
    fs.writeFileSync(invalidHistoryPath, "{ not json", "utf8");

    assert.throws(
      () => prepareHistoryData({ dataDir: fixture.dir, historyPath: invalidHistoryPath }),
      /invalid canonical history JSON/,
    );
    assert.deepEqual(snapshot(fixture.dir), before);

    const duplicate = structuredClone(history);
    duplicate.days[1].items[0].id = duplicate.days[0].items[0].id;
    const duplicatePath = path.join(invalidDir, "duplicate-history.json");
    fs.writeFileSync(duplicatePath, JSON.stringify(duplicate), "utf8");
    assert.throws(
      () => prepareHistoryData({ dataDir: fixture.dir, historyPath: duplicatePath }),
      /duplicate item id/,
    );
    assert.deepEqual(snapshot(fixture.dir), before);
    fs.rmSync(invalidDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
