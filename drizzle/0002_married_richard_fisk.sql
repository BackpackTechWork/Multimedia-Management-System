DELETE f1 FROM `favorites` f1
INNER JOIN `favorites` f2
  ON f1.`user_id` = f2.`user_id`
  AND f1.`file_id` = f2.`file_id`
  AND f1.`id` > f2.`id`
WHERE f1.`file_id` IS NOT NULL;--> statement-breakpoint
DELETE f1 FROM `favorites` f1
INNER JOIN `favorites` f2
  ON f1.`user_id` = f2.`user_id`
  AND f1.`folder_id` = f2.`folder_id`
  AND f1.`id` > f2.`id`
WHERE f1.`folder_id` IS NOT NULL;--> statement-breakpoint
DELETE r1 FROM `recent_activity` r1
INNER JOIN `recent_activity` r2
  ON r1.`user_id` = r2.`user_id`
  AND r1.`file_id` = r2.`file_id`
  AND r1.`id` > r2.`id`;--> statement-breakpoint
ALTER TABLE `favorites` ADD CONSTRAINT `fav_user_file_idx` UNIQUE(`user_id`,`file_id`);--> statement-breakpoint
ALTER TABLE `favorites` ADD CONSTRAINT `fav_user_folder_idx` UNIQUE(`user_id`,`folder_id`);--> statement-breakpoint
ALTER TABLE `recent_activity` ADD CONSTRAINT `recent_user_file_idx` UNIQUE(`user_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `folders_user_parent_idx` ON `folders` (`user_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_user_path_idx` ON `folders` (`user_id`,`path`);--> statement-breakpoint
CREATE INDEX `files_user_folder_idx` ON `files` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `files_user_created_idx` ON `files` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trash_entity_idx` ON `trash_items` (`entity_id`,`entity_type`);--> statement-breakpoint
CREATE INDEX `trash_user_entity_idx` ON `trash_items` (`user_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `recent_user_last_opened_idx` ON `recent_activity` (`user_id`,`last_opened_at`);
