-- 0009_add_user_channel_quota.sql
-- 用户 · 通道级三态配额：
--   mode = 'off'       关闭通道（该用户不可用此通道）
--   mode = 'unlimited' 不限制
--   mode = 'custom'    自定义配额（quota_bytes 生效）
-- 用户在表中没有任何行 = 「全部通道共享」模式（默认）。
CREATE TABLE IF NOT EXISTS user_channel_quota (
    user_id     TEXT NOT NULL,
    channel     TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'off',
    quota_bytes INTEGER DEFAULT 0,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_ucq_user ON user_channel_quota(user_id);
