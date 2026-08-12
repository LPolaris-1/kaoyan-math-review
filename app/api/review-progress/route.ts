import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { reviewProgress } from "../../../db/schema";
import { FREQUENCIES, scheduleReview, shanghaiToday } from "../../../lib/review-schedule.mjs";

type ReviewAction = "review" | "master" | "unmaster" | "setFrequency";
type ReviewResult = "wrong" | "hard" | "correct";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录后使用滚动复习。" }, { status: 401 });

  try {
    const rows = await getDb()
      .select()
      .from(reviewProgress)
      .where(eq(reviewProgress.userEmail, user.email));
    return Response.json({ progress: rows.map(toClientProgress) });
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
  if (!["review", "master", "unmaster", "setFrequency"].includes(payload.action ?? "")) {
    return Response.json({ error: "复习操作无效。" }, { status: 400 });
  }
  if (payload.action === "review" && !["wrong", "hard", "correct"].includes(payload.result ?? "")) {
    return Response.json({ error: "复习结果无效。" }, { status: 400 });
  }
  if (payload.action === "setFrequency" && !FREQUENCIES.includes(payload.frequency ?? "")) {
    return Response.json({ error: "考频选项无效。" }, { status: 400 });
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
    const today = shanghaiToday();
    const now = new Date().toISOString();
    const base = existing ?? {
      userEmail: user.email,
      itemId,
      masteryLevel: 0,
      examFrequency: "unknown",
      reviewStage: 0,
      nextReviewDate: today,
      mastered: 0,
      lastReviewedAt: null,
      lastResult: null,
      updatedAt: now,
    };

    let changes: Partial<typeof base>;
    switch (payload.action) {
      case "review":
        changes = {
          ...scheduleReview(base, payload.result, today),
          mastered: 0,
          lastReviewedAt: now,
          updatedAt: now,
        };
        break;
      case "master":
        changes = { mastered: 1, masteryLevel: 5, updatedAt: now };
        break;
      case "unmaster":
        changes = { mastered: 0, nextReviewDate: today, updatedAt: now };
        break;
      default:
        changes = { examFrequency: payload.frequency ?? "unknown", updatedAt: now };
    }

    const values = { ...base, ...changes };
    const [saved] = await db
      .insert(reviewProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [reviewProgress.userEmail, reviewProgress.itemId],
        set: changes,
      })
      .returning();
    return Response.json({ progress: toClientProgress(saved) });
  } catch (error) {
    return databaseError(error);
  }
}

function toClientProgress(row: typeof reviewProgress.$inferSelect) {
  return {
    itemId: row.itemId,
    masteryLevel: row.masteryLevel,
    examFrequency: row.examFrequency,
    reviewStage: row.reviewStage,
    nextReviewDate: row.nextReviewDate,
    mastered: Boolean(row.mastered),
    lastReviewedAt: row.lastReviewedAt,
    lastResult: row.lastResult,
    updatedAt: row.updatedAt,
  };
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
