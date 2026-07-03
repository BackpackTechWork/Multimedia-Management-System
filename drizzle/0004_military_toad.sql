CREATE TABLE `share_recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`share_id` int NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `share_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `share_recipients_share_user_idx` UNIQUE(`share_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `shares` ADD `created_by_id` int;--> statement-breakpoint
CREATE INDEX `share_recipients_share_id_idx` ON `share_recipients` (`share_id`);--> statement-breakpoint
CREATE INDEX `share_recipients_user_id_idx` ON `share_recipients` (`user_id`);--> statement-breakpoint
CREATE INDEX `share_created_by_idx` ON `shares` (`created_by_id`);
