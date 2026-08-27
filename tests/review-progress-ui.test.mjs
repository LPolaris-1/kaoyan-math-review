import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const componentPath = new URL("../app/components/review/progress-overview.tsx", import.meta.url);
const pagePath = new URL("../app/review/page.tsx", import.meta.url);
const cssPath = new URL("../app/globals.css", import.meta.url);

test("全部进度页面使用统一调度输出并提供 Day 1 API 操作", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /getReviewProgressMeta/);
  assert.match(source, /getTimelineNodes/);
  assert.match(source, /action: \"setCycleStart\"/);
  assert.match(source, /尚未设置艾宾浩斯 Day 1/);
  assert.match(source, /今天设为 Day 1/);
  assert.match(source, /type=\"date\"/);
});

test("复习页保留今日、四象限、已掌握并接入全部进度入口", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /全部进度/);
  assert.match(source, /ProgressOverview/);
  assert.match(source, /tab === \"today\"/);
  assert.match(source, /tab === \"matrix\"/);
  assert.match(source, /tab === \"mastered\"/);
});

test("全部进度样式包含桌面六节点和移动端响应式布局", async () => {
  const source = await readFile(cssPath, "utf8");
  assert.match(source, /\.progress-timeline \{[^}]*repeat\(6/);
  assert.match(source, /\.progress-timeline \{ grid-template-columns: repeat\(3, 1fr\); \}/);
  assert.match(source, /\.progress-filters input \{ grid-column: span 2; \}/);
});
