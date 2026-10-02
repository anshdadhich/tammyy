CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `candidate_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`job_id` text,
	`score` real,
	`match_reasons_json` text,
	`status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_matches_search_candidate_unique` ON `candidate_matches` (`search_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_matches_candidate_idx` ON `candidate_matches` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_matches_created_idx` ON `candidate_matches` (`created_at`);--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`summary_markdown` text,
	`summary_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidate_skills` (
	`candidate_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`experience_years` real,
	`proficiency_level` text,
	`source` text,
	PRIMARY KEY(`candidate_id`, `skill_id`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidate_skills_skill_idx` ON `candidate_skills` (`skill_id`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`full_name` text NOT NULL,
	`headline` text,
	`domain` text NOT NULL,
	`current_position` text,
	`total_experience_years` real,
	`education_level` text,
	`location_city` text,
	`location_country` text,
	`remote_preference` text,
	`open_to_relocation` integer DEFAULT false NOT NULL,
	`min_salary` real,
	`salary_currency` text,
	`salary_frequency` text,
	`salary_negotiable` integer DEFAULT true NOT NULL,
	`availability_status` text,
	`notice_period` text,
	`visibility_status` text DEFAULT 'hidden' NOT NULL,
	`consent_status` text,
	`show_email` integer DEFAULT false NOT NULL,
	`show_phone` integer DEFAULT false NOT NULL,
	`show_linkedin` integer DEFAULT false NOT NULL,
	`show_github` integer DEFAULT false NOT NULL,
	`show_resume` integer DEFAULT false NOT NULL,
	`show_portfolio` integer DEFAULT false NOT NULL,
	`show_photo` integer DEFAULT false NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`github_url` text,
	`linkedin_url` text,
	`portfolio_url` text,
	`resume_url` text,
	`photo_url` text,
	`profile_strength` real,
	`freshness_updated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `candidates_user_id_idx` ON `candidates` (`user_id`);--> statement-breakpoint
CREATE INDEX `candidates_contact_email_idx` ON `candidates` (`contact_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `candidates_visibility_idx` ON `candidates` (`visibility_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_log` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text,
	`candidate_id` text,
	`job_id` text,
	`channel` text NOT NULL,
	`message` text,
	`message_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_log_candidate_idx` ON `contact_log` (`candidate_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_log_employer_idx` ON `contact_log` (`employer_id`,`candidate_id`);--> statement-breakpoint
CREATE TABLE `education` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`institution` text NOT NULL,
	`degree` text,
	`field_of_study` text,
	`start_year` integer,
	`end_year` integer,
	`achievements` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `education_candidate_idx` ON `education` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `employer_quotas` (
	`employer_id` text PRIMARY KEY NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`search_limit` integer NOT NULL,
	`cycle_started_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `employers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`company_name` text NOT NULL,
	`company_email` text,
	`website` text,
	`linkedin_url` text,
	`company_size` text,
	`industry` text,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `employers_user_idx` ON `employers` (`user_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text NOT NULL,
	`title` text NOT NULL,
	`domain` text,
	`seniority` text,
	`description` text,
	`responsibilities` text,
	`screening_requirements` text,
	`must_have_skills` text,
	`nice_to_have_skills` text,
	`min_experience` real,
	`max_experience` real,
	`salary_min` real,
	`salary_max` real,
	`salary_currency` text,
	`location` text,
	`remote_policy` text,
	`relocation_allowed` integer DEFAULT false NOT NULL,
	`employment_type` text,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_employer_idx` ON `jobs` (`employer_id`);--> statement-breakpoint
CREATE TABLE `open_source_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`repo_name` text NOT NULL,
	`repo_url` text,
	`description` text,
	`pr_links` text,
	`tech_stack` text,
	`role` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oss_candidate_idx` ON `open_source_contributions` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `profile_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`chunk_type` text NOT NULL,
	`content_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`metadata_json` text,
	`embedding_dim` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_chunks_candidate_idx` ON `profile_chunks` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `project_depth_analysis` (
	`project_id` text PRIMARY KEY NOT NULL,
	`complexity_score` integer DEFAULT 5 NOT NULL,
	`technical_complexity` text DEFAULT 'medium' NOT NULL,
	`architectural_concepts` text,
	`evidence_quality` text DEFAULT 'moderate' NOT NULL,
	`autonomy_level` text DEFAULT 'unknown' NOT NULL,
	`relevance_tags` text,
	`raw_ai_analysis` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`problem_statement` text,
	`tech_stack` text,
	`role_in_project` text,
	`project_link` text,
	`repo_link` text,
	`deployment_link` text,
	`impact_summary` text,
	`project_type` text,
	`start_date` text,
	`end_date` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_candidate_idx` ON `projects` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text,
	`query_text` text NOT NULL,
	`query_hash` text,
	`filters_json` text,
	`result_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `searches_employer_idx` ON `searches` (`employer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `searches_query_hash_idx` ON `searches` (`query_hash`);--> statement-breakpoint
CREATE INDEX `searches_created_idx` ON `searches` (`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `shortlists` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text,
	`candidate_id` text NOT NULL,
	`job_id` text,
	`status` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shortlists_candidate_idx` ON `shortlists` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `shortlists_employer_idx` ON `shortlists` (`employer_id`,`candidate_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text,
	`category` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_unique` ON `skills` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `work_experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`company_name` text NOT NULL,
	`job_title` text NOT NULL,
	`employment_type` text,
	`start_date` text,
	`end_date` text,
	`is_current` integer DEFAULT false NOT NULL,
	`description` text,
	`achievements` text,
	`tech_stack` text,
	`evidence_links` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_experiences_candidate_idx` ON `work_experiences` (`candidate_id`);