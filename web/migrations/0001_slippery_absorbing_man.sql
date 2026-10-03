PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shortlists` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text,
	`candidate_id` text NOT NULL,
	`job_id` text DEFAULT '' NOT NULL,
	`status` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_shortlists`("id", "employer_id", "candidate_id", "job_id", "status", "notes", "created_at") SELECT "id", "employer_id", "candidate_id", "job_id", "status", "notes", "created_at" FROM `shortlists`;--> statement-breakpoint
DROP TABLE `shortlists`;--> statement-breakpoint
ALTER TABLE `__new_shortlists` RENAME TO `shortlists`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shortlists_candidate_idx` ON `shortlists` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `shortlists_employer_idx` ON `shortlists` (`employer_id`,`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shortlists_unique` ON `shortlists` (`employer_id`,`candidate_id`,`job_id`);