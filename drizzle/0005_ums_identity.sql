ALTER TABLE `users` ADD `ums_user_id` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_ums_user_id_idx` UNIQUE(`ums_user_id`);
