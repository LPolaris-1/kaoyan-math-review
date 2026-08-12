CREATE TABLE `review_progress` (
	`user_email` text NOT NULL,
	`item_id` text NOT NULL,
	`mastery_level` integer DEFAULT 0 NOT NULL,
	`exam_frequency` text DEFAULT 'unknown' NOT NULL,
	`review_stage` integer DEFAULT 0 NOT NULL,
	`next_review_date` text NOT NULL,
	`mastered` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` text,
	`last_result` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `review_progress_due_idx` ON `review_progress` (`user_email`,`mastered`,`next_review_date`);