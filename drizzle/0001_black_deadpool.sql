CREATE TABLE `review_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`item_id` text NOT NULL,
	`event_type` text NOT NULL,
	`result` text,
	`occurred_at` text NOT NULL,
	`occurred_date` text NOT NULL,
	`cycle_started_at` text,
	`target_day` integer,
	`scheduled_date` text,
	`review_stage_before` integer,
	`review_stage_after` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_events_item_time_idx` ON `review_events` (`user_email`,`item_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `review_events_user_date_idx` ON `review_events` (`user_email`,`occurred_date`);--> statement-breakpoint
ALTER TABLE `review_progress` ADD `cycle_started_at` text;