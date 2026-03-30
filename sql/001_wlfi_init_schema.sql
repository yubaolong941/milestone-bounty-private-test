-- Generated from live MySQL schema
-- Source database: swap_trade
-- Generated at: 2026-03-29T05:29:56.768Z
SET NAMES utf8mb4;

-- wlfi_companies
CREATE TABLE IF NOT EXISTS `wlfi_companies` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','active','suspended') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `github_org_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_org_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_management_tool` enum('meegle','jira','linear','github_projects','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_management_tool_label` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_workspace_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_project_key` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_view_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_mcp_token` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documentation_tool` enum('lark','slack','notion','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documentation_tool_label` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lark_webhook_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lark_webhook_secret` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lark_default_receive_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `website_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_email` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `default_repo_config_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_wallet_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_wlfi_companies_status` (`status`),
  KEY `idx_wlfi_companies_created_by` (`created_by_user_id`),
  KEY `fk_wlfi_companies_active_wallet` (`active_wallet_id`),
  KEY `idx_wlfi_companies_github_org_login` (`github_org_login`),
  KEY `idx_wlfi_companies_pm_tool` (`project_management_tool`),
  KEY `idx_wlfi_companies_doc_tool` (`documentation_tool`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_company_wallets
CREATE TABLE IF NOT EXISTS `wlfi_company_wallets` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wallet_label` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci NOT NULL,
  `network` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_symbol` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `verification_method` enum('wallet_signature','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'wallet_signature',
  `verified_signature_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_by_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `verified_by_github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_at` datetime(3) NOT NULL,
  `last_used_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_company_wallet_address` (`company_id`,`wallet_address`),
  KEY `idx_wlfi_company_wallets_active` (`company_id`,`active`),
  CONSTRAINT `fk_wlfi_company_wallets_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_company_memberships
CREATE TABLE IF NOT EXISTS `wlfi_company_memberships` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('company_owner','company_admin','company_finance','company_reviewer','company_maintainer','company_viewer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','invited','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'invited',
  `invited_by_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invited_at` datetime(3) DEFAULT NULL,
  `accepted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_company_user` (`company_id`,`user_id`),
  KEY `idx_wlfi_company_memberships_github_user` (`github_user_id`),
  KEY `idx_wlfi_company_memberships_role` (`company_id`,`role`),
  KEY `idx_wlfi_company_memberships_status` (`company_id`,`status`),
  CONSTRAINT `fk_wlfi_company_memberships_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_recipient_profiles
CREATE TABLE IF NOT EXISTS `wlfi_recipient_profiles` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('individual','team') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'individual',
  `display_name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `identity_source` enum('github_code_bounty','wallet_security_bounty','hybrid') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_recipient_profiles_owner` (`owner_user_id`),
  KEY `idx_wlfi_recipient_profiles_github` (`github_login`),
  KEY `idx_wlfi_recipient_profiles_external_user` (`external_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_audit_logs
CREATE TABLE IF NOT EXISTS `wlfi_audit_logs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_role` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_type` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_audit_logs_company_created` (`company_id`,`created_at`),
  KEY `idx_wlfi_audit_logs_action` (`action`,`created_at`),
  CONSTRAINT `fk_wlfi_audit_logs_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_repo_configs
CREATE TABLE IF NOT EXISTS `wlfi_repo_configs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider` enum('github') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'github',
  `owner` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `repo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `default_branch` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'main',
  `token_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sync_interval_sec` int DEFAULT NULL,
  `config_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_repo_configs_company_repo` (`company_id`,`provider`,`owner`,`repo`),
  KEY `idx_wlfi_repo_configs_company_updated` (`company_id`,`updated_at`),
  CONSTRAINT `fk_wlfi_repo_configs_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_internal_member_bindings
CREATE TABLE IF NOT EXISTS `wlfi_internal_member_bindings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_assignee` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `github_login` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `repo_config_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `repo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `binding_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_internal_member_bindings_company_updated` (`company_id`,`updated_at`),
  KEY `idx_wlfi_internal_member_bindings_assignee_enabled` (`meegle_assignee`,`enabled`),
  KEY `fk_wlfi_internal_member_bindings_repo_config` (`repo_config_id`),
  CONSTRAINT `fk_wlfi_internal_member_bindings_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wlfi_internal_member_bindings_repo_config` FOREIGN KEY (`repo_config_id`) REFERENCES `wlfi_repo_configs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_integration_health_states
CREATE TABLE IF NOT EXISTS `wlfi_integration_health_states` (
  `integration` enum('meegle_sync','github_issue_sync','lark_notify') COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_status` enum('success','failure') COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_success_at` datetime(3) DEFAULT NULL,
  `last_failure_at` datetime(3) DEFAULT NULL,
  `last_detail` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `consecutive_failures` int NOT NULL DEFAULT '0',
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`integration`),
  KEY `idx_wlfi_integration_health_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_notifications
CREATE TABLE IF NOT EXISTS `wlfi_notifications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `severity` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` enum('inbox','lark') COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('task_status','manual_review','payment_failure','escrow','integration') COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledged` tinyint(1) NOT NULL DEFAULT '0',
  `metadata` json DEFAULT NULL,
  `notification_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_notifications_company_created` (`company_id`,`created_at`),
  KEY `idx_wlfi_notifications_ack_created` (`acknowledged`,`created_at`),
  KEY `idx_wlfi_notifications_category_created` (`category`,`created_at`),
  CONSTRAINT `fk_wlfi_notifications_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_wallet_identity_bindings
CREATE TABLE IF NOT EXISTS `wlfi_wallet_identity_bindings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_role` enum('company_operator','bounty_claimer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci NOT NULL,
  `external_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auth_source` enum('github_oauth_wallet_signature','wallet_signature') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','revoked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `verified_at` datetime(3) NOT NULL,
  `binding_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_wallet_identity_actor_wallet` (`actor_role`,`wallet_address`),
  KEY `idx_wlfi_wallet_identity_github` (`actor_role`,`github_login`,`status`),
  KEY `idx_wlfi_wallet_identity_external` (`external_user_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_task_claims
CREATE TABLE IF NOT EXISTS `wlfi_task_claims` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_profile_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `claimer_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claimer_github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `share_pct` decimal(5,2) NOT NULL DEFAULT '100.00',
  `claimed_at` datetime(3) NOT NULL,
  `approved_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_task_claims_task` (`task_id`,`status`),
  KEY `idx_wlfi_task_claims_company` (`company_id`,`status`),
  KEY `fk_wlfi_task_claims_recipient` (`recipient_profile_id`),
  CONSTRAINT `fk_wlfi_task_claims_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wlfi_task_claims_recipient` FOREIGN KEY (`recipient_profile_id`) REFERENCES `wlfi_recipient_profiles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_task_bounties
CREATE TABLE IF NOT EXISTS `wlfi_task_bounties` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` enum('internal','external') COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `repo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reward_amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `reward_token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USD1',
  `claimed_by_github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `developer_wallet` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_company_wallet_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_issue_number` int DEFAULT NULL,
  `task_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_task_bounties_company_status` (`company_id`,`status`,`updated_at`),
  KEY `idx_wlfi_task_bounties_source_status` (`source`,`status`,`updated_at`),
  KEY `idx_wlfi_task_bounties_repo_issue` (`repo`,`github_issue_number`),
  KEY `fk_wlfi_task_bounties_wallet` (`payer_company_wallet_id`),
  CONSTRAINT `fk_wlfi_task_bounties_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wlfi_task_bounties_wallet` FOREIGN KEY (`payer_company_wallet_id`) REFERENCES `wlfi_company_wallets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_payments
CREATE TABLE IF NOT EXISTS `wlfi_payments` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `report_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_address` varchar(90) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `token_symbol` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paid_at` datetime(3) NOT NULL,
  `payment_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlfi_payments_company_paid` (`company_id`,`paid_at`),
  KEY `idx_wlfi_payments_report` (`report_id`,`paid_at`),
  KEY `idx_wlfi_payments_tx_hash` (`tx_hash`),
  CONSTRAINT `fk_wlfi_payments_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_requirement_bindings
CREATE TABLE IF NOT EXISTS `wlfi_requirement_bindings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requirement_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lark_doc_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lark_doc_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_issue_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meegle_status` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_repo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `github_issue_number` int DEFAULT NULL,
  `github_issue_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acceptance_criteria_json` json NOT NULL,
  `summary_snapshot` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_version` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_version` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` enum('task_create','task_promote','meegle_sync','github_issue_sync','manual') COLLATE utf8mb4_unicode_ci NOT NULL,
  `binding_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_requirement_bindings_requirement` (`requirement_id`),
  KEY `idx_wlfi_requirement_bindings_company_updated` (`company_id`,`updated_at`),
  KEY `idx_wlfi_requirement_bindings_meegle_issue` (`meegle_issue_id`),
  CONSTRAINT `fk_wlfi_requirement_bindings_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_treasury_fundings
CREATE TABLE IF NOT EXISTS `wlfi_treasury_fundings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `allocated_amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `remaining_amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `token_symbol` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `network` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('received','allocated','partially_allocated','released','exhausted','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  `source` enum('wallet_payment','task_publish') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'wallet_payment',
  `linked_task_ids_json` json NOT NULL,
  `linked_task_titles_json` json NOT NULL,
  `verified_at` datetime(3) DEFAULT NULL,
  `recorded_by_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `funding_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_treasury_fundings_tx_hash` (`tx_hash`),
  KEY `idx_wlfi_treasury_fundings_company_created` (`company_id`,`created_at`),
  KEY `idx_wlfi_treasury_fundings_status_updated` (`status`,`updated_at`),
  CONSTRAINT `fk_wlfi_treasury_fundings_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_settlement_cases
CREATE TABLE IF NOT EXISTS `wlfi_settlement_cases` (
  `id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `allocated_amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `treasury_funding_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `treasury_funding_tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_wallet_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_github_login` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_wallet_frozen_at` datetime(3) DEFAULT NULL,
  `recipient_wallet_source` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `funding_lock_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `funding_tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `funding_reserved_at` datetime(3) DEFAULT NULL,
  `release_tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `funding_state` enum('not_required','pending_lock','locked','lock_failed','released','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_required',
  `payout_state` enum('not_ready','ready','processing','paid','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_ready',
  `payout_tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failure_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retry_strategy` enum('auto_retry','manual_retry','no_retry') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_error` text COLLATE utf8mb4_unicode_ci,
  `last_attempt_at` datetime(3) DEFAULT NULL,
  `paid_at` datetime(3) DEFAULT NULL,
  `source_task_status` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `settlement_json` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_settlement_cases_task` (`task_id`),
  KEY `idx_wlfi_settlement_cases_company_updated` (`company_id`,`updated_at`),
  KEY `idx_wlfi_settlement_cases_payout_state` (`payout_state`,`updated_at`),
  KEY `idx_wlfi_settlement_cases_treasury_funding` (`treasury_funding_id`),
  KEY `idx_wlfi_settlement_cases_treasury_tx` (`treasury_funding_tx_hash`),
  CONSTRAINT `fk_wlfi_settlement_cases_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_payout_attempts
CREATE TABLE IF NOT EXISTS `wlfi_payout_attempts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `settlement_case_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payout_context` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `idempotency_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('processing','succeeded','failed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
  `active_execution` tinyint(1) DEFAULT '1',
  `amount` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error` text COLLATE utf8mb4_unicode_ci,
  `request_payload` json NOT NULL,
  `result_payload` json DEFAULT NULL,
  `attempt_json` json NOT NULL,
  `started_at` datetime(3) NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_payout_attempts_idempotency` (`idempotency_key`),
  UNIQUE KEY `uniq_wlfi_payout_attempts_active_execution` (`settlement_case_id`,`active_execution`),
  KEY `idx_wlfi_payout_attempts_task_created` (`task_id`,`created_at`),
  KEY `idx_wlfi_payout_attempts_status_created` (`status`,`created_at`),
  KEY `idx_wlfi_payout_attempts_tx_hash` (`tx_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wlfi_workflow_events
CREATE TABLE IF NOT EXISTS `wlfi_workflow_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_type` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_type` enum('user','system','webhook','cron') COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `idempotency_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('processing','processed','dead_letter') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
  `payload` json NOT NULL,
  `result` json DEFAULT NULL,
  `error` text COLLATE utf8mb4_unicode_ci,
  `replay_count` int NOT NULL DEFAULT '0',
  `last_replayed_at` datetime(3) DEFAULT NULL,
  `processed_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wlfi_workflow_events_idempotency` (`idempotency_key`),
  KEY `idx_wlfi_workflow_events_task_created` (`task_id`,`created_at`),
  KEY `idx_wlfi_workflow_events_status_created` (`status`,`created_at`),
  KEY `idx_wlfi_workflow_events_event_type_created` (`event_type`,`created_at`),
  KEY `fk_wlfi_workflow_events_company` (`company_id`),
  CONSTRAINT `fk_wlfi_workflow_events_company` FOREIGN KEY (`company_id`) REFERENCES `wlfi_companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the cyclic foreign key after wlfi_company_wallets exists
SET @wlfi_add_active_wallet_fk = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wlfi_companies'
      AND CONSTRAINT_NAME = 'fk_wlfi_companies_active_wallet'
  ),
  'SELECT 1',
  'ALTER TABLE `wlfi_companies` ADD CONSTRAINT `fk_wlfi_companies_active_wallet` FOREIGN KEY (`active_wallet_id`) REFERENCES `wlfi_company_wallets` (`id`) ON DELETE SET NULL'
);
PREPARE wlfi_stmt FROM @wlfi_add_active_wallet_fk;
EXECUTE wlfi_stmt;
DEALLOCATE PREPARE wlfi_stmt;
