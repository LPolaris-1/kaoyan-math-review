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
