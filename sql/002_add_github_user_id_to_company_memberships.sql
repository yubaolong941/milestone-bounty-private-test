SET @has_github_user_id_col = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wlfi_company_memberships'
    AND COLUMN_NAME = 'github_user_id'
);

SET @add_github_user_id_col_sql = IF(
  @has_github_user_id_col = 0,
  'ALTER TABLE `wlfi_company_memberships` ADD COLUMN `github_user_id` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `github_login`',
  'SELECT 1'
);
PREPARE stmt_add_github_user_id_col FROM @add_github_user_id_col_sql;
EXECUTE stmt_add_github_user_id_col;
DEALLOCATE PREPARE stmt_add_github_user_id_col;

SET @has_github_user_id_idx = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wlfi_company_memberships'
    AND INDEX_NAME = 'idx_wlfi_company_memberships_github_user'
);

SET @add_github_user_id_idx_sql = IF(
  @has_github_user_id_idx = 0,
  'ALTER TABLE `wlfi_company_memberships` ADD KEY `idx_wlfi_company_memberships_github_user` (`github_user_id`)',
  'SELECT 1'
);
PREPARE stmt_add_github_user_id_idx FROM @add_github_user_id_idx_sql;
EXECUTE stmt_add_github_user_id_idx;
DEALLOCATE PREPARE stmt_add_github_user_id_idx;

UPDATE `wlfi_company_memberships` m
LEFT JOIN `wlfi_recipient_profiles` rp
  ON LOWER(COALESCE(rp.github_login, '')) = LOWER(COALESCE(m.github_login, ''))
SET m.github_user_id = COALESCE(
  m.github_user_id,
  rp.github_user_id,
  CASE
    WHEN m.user_id REGEXP '^[0-9]+$' THEN m.user_id
    ELSE NULL
  END
)
WHERE m.github_user_id IS NULL;
