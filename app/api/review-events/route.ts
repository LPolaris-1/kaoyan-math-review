import { and, asc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { reviewEvents } from "../../../db/schema";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录后查看复习历史。" }, { status: 401 });

  const itemId = new URL(request.url).searchParams.get("itemId")?.trim() ?? "";
  if (!itemId || itemId.length > 240) {
    return Response.json({ error: "题目标识无效。" }, { status: 400 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.userEmail, user.email), eq(reviewEvents.itemId, itemId)))
      .orderBy(asc(reviewEvents.occurredAt), asc(reviewEvents.id));
    return Response.json({ events: rows.map(toClientEvent) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据库暂时不可用。";
    const unavailable = message.includes("D1 binding") || message.includes("no such table");
    return Response.json(
      { error: unavailable ? "复习历史库尚未就绪，请稍后再试。" : "读取复习历史失败，请稍后重试。" },
      { status: 503 },
    );
  }
}

function toClientEvent(row: typeof reviewEvents.$inferSelect) {
  return {
    id: row.id,
    itemId: row.itemId,
    eventType: row.eventType,
    result: row.result,
    reviewedAt: row.occurredAt,
    occurredAt: row.occurredAt,
    occurredDate: row.occurredDate,
    cycleStartedAt: row.cycleStartedAt,
    targetDay: row.targetDay,
    scheduledDate: row.scheduledDate,
    reviewStageBefore: row.reviewStageBefore,
    reviewStageAfter: row.reviewStageAfter,
    createdAt: row.createdAt,
  };
}
