import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const componentPath = new URL("../app/components/review/progress-overview.tsx", import.meta.url);
const overviewPath = new URL("../app/components/review/review-overview.tsx", import.meta.url);
const overviewLibPath = new URL("../lib/review-overview.mjs", import.meta.url);
const pagePath = new URL("../app/review/page.tsx", import.meta.url);
const eventsRoutePath = new URL("../app/api/review-events/route.ts", import.meta.url);
const cssPath = new URL("../app/globals.css", import.meta.url);
const homePath = new URL("../app/page.tsx", import.meta.url);

test("全部进度页面使用统一调度输出并提供 Day 1 API 操作", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /getReviewProgressMeta/);
  assert.match(source, /getTimelineNodes/);
  assert.match(source, /action: \"setCycleStart\"/);
  assert.match(source, /尚未设置艾宾浩斯 Day 1/);
  assert.match(source, /今天设为 Day 1/);
  assert.match(source, /type=\"date\"/);
  assert.match(source, /立即复习/);
  assert.match(source, /meta\.phase !== \"unstarted\" && meta\.phase !== \"mastered\"/);
  assert.match(source, /\"1\": \"Day 4\"/);
  assert.match(source, /\"2\": \"Day 7\"/);
  assert.match(source, /\"3\": \"Day 30\"/);
  assert.match(source, /\"4\": \"长期巩固\"/);
  assert.doesNotMatch(source, /Day 2|Day 15/);
});

test("复习页保留今日、四象限、已掌握并接入全部进度入口", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /全部进度/);
  assert.match(source, /复习总览/);
  assert.match(source, /manualReviewId/);
  assert.match(source, /source === \"manual\"/);
  assert.match(source, /新错题 · 首次复习/);
  assert.match(source, /ProgressOverview/);
  assert.match(source, /tab === \"today\"/);
  assert.match(source, /tab === \"matrix\"/);
  assert.match(source, /tab === \"mastered\"/);
  assert.equal(source.includes("/api/review-events?date="), true);
  assert.match(source, /buildTodayProgress/);
  assert.match(source, /reviewedTodayIds/);
  assert.match(source, /buildDailyQueue\(allItems, progressById, today, reviewedTodayIds\)/);
  assert.match(source, /今日复习进度/);
  assert.match(source, /今日已复习/);
  assert.match(source, /role=\"progressbar\"/);
  assert.match(source, /<TodayProgress progress=\{todayProgress\} \/>/);
  assert.doesNotMatch(source, /initialTodayQueueIds !== null && <TodayProgress/);
  assert.match(source, /disabled=\{savingId === item\.id\}/);
});

test("复习总览使用客户端派生时间轴、KPI、逾期和四象限筛选", async () => {
  const source = await readFile(overviewPath, "utf8");
  const library = await readFile(overviewLibPath, "utf8");
  assert.match(source, /ReviewOverview/);
  assert.match(source, /今日到期/);
  assert.match(source, /已逾期/);
  assert.match(source, /未来 7 天/);
  assert.match(source, /未来 30 天/);
  assert.match(source, /未设置 Day 1/);
  assert.match(source, /overview-timeline/);
  assert.match(source, /四象限/);
  assert.match(source, /onReviewNow\(item\.id\)/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.match(library, /groupReviewsByDate/);
  assert.match(library, /groupOverdue/);
  assert.match(library, /buildQuadrantEntries/);
});

test("全部进度样式包含桌面四节点和移动端响应式布局", async () => {
  const source = await readFile(cssPath, "utf8");
  assert.match(source, /\.progress-timeline \{[^}]*repeat\(6/);
  assert.match(source, /\.progress-timeline \{ grid-template-columns: repeat\(3, 1fr\); \}/);
  assert.match(source, /\.progress-filters input \{ grid-column: span 2; \}/);
  assert.match(source, /\.queue-intake/);
  assert.match(source, /\.today-progress/);
  assert.match(source, /\.today-progress-track/);
});

test("复习事件 API 支持按日期批量读取并保留单题查询", async () => {
  const source = await readFile(eventsRoutePath, "utf8");
  assert.match(source, /searchParams\.get\("date"\)/);
  assert.match(source, /eq\(reviewEvents\.occurredDate, occurredDate\)/);
  assert.match(source, /eq\(reviewEvents\.itemId, itemId\)/);
  assert.match(source, /displayTargetDay/);
  assert.match(source, /targetDay: row\.targetDay/);
});

test("首页提供 每日复盘/真题 双标签并按 isPastExam 派生，且复用已掌握与懒加载卡片", async () => {
  const source = await readFile(homePath, "utf8");
  const css = await readFile(cssPath, "utf8");
  assert.match(source, /mode-tabs/);
  assert.match(source, /label: "每日复盘"/);
  assert.match(source, /label: "真题"/);
  assert.match(source, /className=\{mode === tab\.id \? "is-active" : ""\}/);
  assert.match(source, /isPastExam/);
  assert.match(source, /derivePastExamDays/);
  assert.match(source, /item\.isPastExam/);
  assert.match(source, /const \[selectedDates, setSelectedDates\] = useState<Record<ReviewMode, string>>/);
  assert.match(source, /selectedDates\[mode\]/);
  assert.match(source, /setSelectedDates\(\(current\) => \(\{ \.\.\.current, \[mode\]: date \}\)\)/);
  assert.match(source, /daily: history\.days\[0\]\?\.date \|\| "", pastExam: derivePastExamDays\(history\.days\)\[0\]\?\.date \|\| ""/);
  assert.match(source, /modeDays\.slice\(0, 14\)/);
  // mastered POST + lazy Markdown/KaTeX card are reused, not duplicated
  assert.match(source, /onSetMastered=\{setMastered\}/);
  assert.match(source, /progressById\[item\.id\]\?\.mastered/);
  assert.equal((source.match(/function HistoryQuestionCard/g) || []).length, 1);
  assert.match(source, /if \(event\.currentTarget\.open\) setHasOpened\(true\)/);
  assert.equal(source.includes("/api/review-progress"), true);
  // no NaN in derived counts
  assert.doesNotMatch(source, /NaN/);
  assert.match(css, /\.mode-tabs \{/);
  assert.match(css, /\.mode-tabs button\.is-active/);
});
