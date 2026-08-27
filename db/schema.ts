import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reviewProgress = sqliteTable(
  "review_progress",
  {
    userEmail: text("user_email").notNull(),
    itemId: text("item_id").notNull(),
    masteryLevel: integer("mastery_level").notNull().default(0),
    examFrequency: text("exam_frequency").notNull().default("unknown"),
    reviewStage: integer("review_stage").notNull().default(0),
    nextReviewDate: text("next_review_date").notNull(),
    cycleStartedAt: text("cycle_started_at"),
    mastered: integer("mastered").notNull().default(0),
    lastReviewedAt: text("last_reviewed_at"),
    lastResult: text("last_result"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userEmail, table.itemId] }),
    index("review_progress_due_idx").on(
      table.userEmail,
      table.mastered,
      table.nextReviewDate,
    ),
  ],
);

export const reviewEvents = sqliteTable(
  "review_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userEmail: text("user_email").notNull(),
    itemId: text("item_id").notNull(),
    eventType: text("event_type").notNull(),
    result: text("result"),
    occurredAt: text("occurred_at").notNull(),
    occurredDate: text("occurred_date").notNull(),
    cycleStartedAt: text("cycle_started_at"),
    targetDay: integer("target_day"),
    scheduledDate: text("scheduled_date"),
    reviewStageBefore: integer("review_stage_before"),
    reviewStageAfter: integer("review_stage_after"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("review_events_item_time_idx").on(table.userEmail, table.itemId, table.occurredAt),
    index("review_events_user_date_idx").on(table.userEmail, table.occurredDate),
  ],
);
