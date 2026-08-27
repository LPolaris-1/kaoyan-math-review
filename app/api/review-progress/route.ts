import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { reviewEvents, reviewProgress } from "../../../db/schema";
import {
  FREQUENCIES,
  addDays,
  getReviewProgressMeta,
  shanghaiToday,
} from "../../../lib/review-schedule.mjs";
import { buildReviewAction } from "../../../lib/review-progress-state.mjs";

type ReviewAction = "review" | "master" | "unmaster" | "setFrequency" | "setCycleStart";
type ReviewResult = "wrong" | "hard" | "correct";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录后使用滚动复习。" }, { status: 401 });

  try {
    const rows = await getDb()
      .select()
      .from(reviewProgress)
      .where(eq(reviewProgress.userEmail, user.email));
    const today = shanghaiToday();
    return Response.json({ progress: rows.map((row) => toClientProgress(row, today)) });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录后保存复习进度。" }, { status: 401 });

  let payload: {
    action?: ReviewAction;
    itemId?: string;
    result?: ReviewResult;
    frequency?: string;
    cycleStartedAt?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效 JSON。" }, { status: 400 });
  }

  const itemId = payload.itemId?.trim() ?? "";
  if (!itemId || itemId.length > 240) {
    return Response.json({ error: "题目标识无效。" }, { status: 400 });
  }
  if (!["review", "master", "unmaster", "setFrequency", "setCycleStart"].includes(payload.action ?? "")) {
    return Response.json({ error: "复习操作无效。" }, { status: 400 });
  }
  if (payload.action === "review" && !["wrong", "hard", "correct"].includes(payload.result ?? "")) {
    return Response.json({ error: "复习结果无效。" }, { status: 400 });
  }
  if (payload.action === "setFrequency" && !FREQUENCIES.includes(payload.frequency ?? "")) {
    return Response.json({ error: "考频选项无效。" }, { status: 400 });
  }
  const today = shanghaiToday();
  if (payload.action === "setCycleStart") {
    if (!isValidCalendarDate(payload.cycleStartedAt) || (payload.cycleStartedAt ?? "") > today) {
      return Response.json({ error: "Day 1 日期无效或不能晚于今天。" }, { status: 400 });
    }
  }

  try {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(reviewProgress)
      .where(
        and(
          eq(reviewProgress.userEmail, user.email),
          eq(reviewProgress.itemId, itemId),
        ),
      )
      .limit(1);
    const now = new Date().toISOString();
    const base = existing ?? {
      userEmail: user.email,
      itemId,
      masteryLevel: 0,
      examFrequency: "unknown",
      reviewStage: 0,
      nextReviewDate: today,
      cycleStartedAt: null,
      mastered: 0,
      lastReviewedAt: null,
      lastResult: null,
      updatedAt: now,
    };

    const { changes, event } = buildReviewAction({
      base,
      action: payload.action as ReviewAction,
      result: payload.result ?? null,
      frequency: payload.frequency ?? null,
      cycleStartedAt: payload.cycleStartedAt ?? null,
      today,
      now,
    });

    const values = { ...base, ...changes };
    const progressMutation = db
      .insert(reviewProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [reviewProgress.userEmail, reviewProgress.itemId],
        set: changes,
      })
      .returning();
    const statements: BatchItem<"sqlite">[] = [progressMutation];
    if (event) {
      statements.push(
        db.insert(reviewEvents).values({
          userEmail: user.email,
          itemId,
          ...event,
        }),
      );
    }
    const batchResults = await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    const savedRows = batchResults[0] as typeof reviewProgress.$inferSelect[];
    const saved = savedRows[0];
    return Response.json({ progress: toClientProgress(saved, today) });
  } catch (error) {
    return databaseError(error);
  }
}

function toClientProgress(row: typeof reviewProgress.$inferSelect, today = shanghaiToday()) {
  return {
    itemId: row.itemId,
    masteryLevel: row.masteryLevel,
    examFrequency: row.examFrequency,
    reviewStage: row.reviewStage,
    nextReviewDate: row.nextReviewDate,
    cycleStartedAt: row.cycleStartedAt,
    mastered: Boolean(row.mastered),
    lastReviewedAt: row.lastReviewedAt,
    lastResult: row.lastResult,
    updatedAt: row.updatedAt,
    reviewMeta: getReviewProgressMeta(row, today),
  };
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "数据库暂时不可用。";
  const unavailable =
    message.includes("D1 binding") ||
    message.includes("no such table") ||
    message.includes("review_progress");
  return Response.json(
    {
      error: unavailable
        ? "复习进度库尚未就绪，历史错题仍可正常浏览，请稍后再试。"
        : "保存复习进度失败，请稍后重试。",
    },
    { status: 503 },
  );
}
