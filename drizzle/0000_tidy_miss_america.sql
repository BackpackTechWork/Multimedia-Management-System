CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_idx` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_id` int,
	`name` varchar(255) NOT NULL,
	`path` varchar(1000) NOT NULL,
	`visibility` varchar(20) NOT NULL DEFAULT 'private',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`folder_id` int,
	`filename` varchar(255) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`extension` varchar(50) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size` bigint NOT NULL,
	`path` varchar(1000) NOT NULL,
	`visibility` varchar(20) NOT NULL DEFAULT 'private',
	`checksum` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `file_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`file_id` int NOT NULL,
	`storage_path` varchar(1000) NOT NULL,
	`version_number` int NOT NULL,
	`size` bigint NOT NULL,
	`uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`uploaded_by` int NOT NULL,
	CONSTRAINT `file_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trash_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`entity_type` varchar(20) NOT NULL,
	`entity_id` int NOT NULL,
	`deleted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`purge_at` datetime NOT NULL,
	CONSTRAINT `trash_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`file_id` int,
	`folder_id` int,
	CONSTRAINT `favorites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recent_activity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`file_id` int NOT NULL,
	`last_opened_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recent_activity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(255) NOT NULL,
	`file_id` int,
	`folder_id` int,
	`password_hash` varchar(255),
	`expires_at` datetime,
	`allow_download` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shares_id` PRIMARY KEY(`id`),
	CONSTRAINT `share_token_idx` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`session_id` varchar(255) NOT NULL,
	`ip_address` varchar(45),
	`user_agent` varchar(500),
	`data` text,
	`last_activity_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sess_id_idx` UNIQUE(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`action` varchar(255) NOT NULL,
	`entity_type` varchar(50) NOT NULL,
	`entity_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_storage_stats` (
	`user_id` int NOT NULL,
	`total_files` bigint NOT NULL DEFAULT 0,
	`total_folders` bigint NOT NULL DEFAULT 0,
	`total_size` bigint NOT NULL DEFAULT 0,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_storage_stats_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(50) NOT NULL,
	`payload` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `folders_user_id_idx` ON `folders` (`user_id`);--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_path_idx` ON `folders` (`path`);--> statement-breakpoint
CREATE INDEX `files_user_id_idx` ON `files` (`user_id`);--> statement-breakpoint
CREATE INDEX `files_folder_id_idx` ON `files` (`folder_id`);--> statement-breakpoint
CREATE INDEX `files_visibility_idx` ON `files` (`visibility`);--> statement-breakpoint
CREATE INDEX `versions_file_id_idx` ON `file_versions` (`file_id`);--> statement-breakpoint
CREATE INDEX `trash_user_id_idx` ON `trash_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `trash_purge_at_idx` ON `trash_items` (`purge_at`);--> statement-breakpoint
CREATE INDEX `fav_user_id_idx` ON `favorites` (`user_id`);--> statement-breakpoint
CREATE INDEX `fav_file_id_idx` ON `favorites` (`file_id`);--> statement-breakpoint
CREATE INDEX `fav_folder_id_idx` ON `favorites` (`folder_id`);--> statement-breakpoint
CREATE INDEX `recent_user_id_idx` ON `recent_activity` (`user_id`);--> statement-breakpoint
CREATE INDEX `recent_file_id_idx` ON `recent_activity` (`file_id`);--> statement-breakpoint
CREATE INDEX `share_file_id_idx` ON `shares` (`file_id`);--> statement-breakpoint
CREATE INDEX `share_folder_id_idx` ON `shares` (`folder_id`);--> statement-breakpoint
CREATE INDEX `sess_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sess_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `log_user_id_idx` ON `activity_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);