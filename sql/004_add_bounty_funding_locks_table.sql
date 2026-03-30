SET @has_wlfi_bounty_funding_locks_table = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wlfi_bounty_funding_locks'
);

SET @create_wlfi_bounty_funding_locks_table_sql = IF(
  @has_wlfi_bounty_funding_locks_table = 0,
  'CREATE TABLE `wlfi_bounty_funding_locks` (
    `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `issue_number` bigint DEFAULT NULL,
    `issue_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `reward_amount` decimal(18,6) NOT NULL DEFAULT ''0.000000'',
    `reward_token` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `payer_company_wallet_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `payer_company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `payer_wallet_address` varchar(90) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `funding_tx_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `lock_contract_address` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `lock_transaction_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `release_transaction_hash` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `onchain_lock_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `onchain_verified_at` datetime(3) DEFAULT NULL,
    `status` enum(''locked'',''released'',''cancelled'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''locked'',
    `created_by_user_id` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
    `lock_json` json NOT NULL,
    `created_at` datetime(3) NOT NULL,
    `updated_at` datetime(3) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_wlfi_bounty_funding_locks_task` (`task_id`,`updated_at`),
    KEY `idx_wlfi_bounty_funding_locks_status` (`status`,`updated_at`),
    KEY `idx_wlfi_bounty_funding_locks_funding_tx_hash` (`funding_tx_hash`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);

PREPARE stmt_create_wlfi_bounty_funding_locks_table FROM @create_wlfi_bounty_funding_locks_table_sql;
EXECUTE stmt_create_wlfi_bounty_funding_locks_table;
DEALLOCATE PREPARE stmt_create_wlfi_bounty_funding_locks_table;
