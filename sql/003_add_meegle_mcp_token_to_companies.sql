SET @has_meegle_mcp_token_col = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wlfi_companies'
    AND COLUMN_NAME = 'meegle_mcp_token'
);

SET @add_meegle_mcp_token_col_sql = IF(
  @has_meegle_mcp_token_col = 0,
  'ALTER TABLE `wlfi_companies` ADD COLUMN `meegle_mcp_token` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `meegle_view_url`',
  'SELECT 1'
);

PREPARE stmt_add_meegle_mcp_token_col FROM @add_meegle_mcp_token_col_sql;
EXECUTE stmt_add_meegle_mcp_token_col;
DEALLOCATE PREPARE stmt_add_meegle_mcp_token_col;
