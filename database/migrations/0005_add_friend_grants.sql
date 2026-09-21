-- 好友整盘授权：允许好友查看/管理自己的整个网盘
CREATE TABLE IF NOT EXISTS friend_grants (
    id TEXT PRIMARY KEY,
    grantor_id TEXT NOT NULL,
    grantee_id TEXT NOT NULL,
    permissions TEXT DEFAULT 'read',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(grantor_id, grantee_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_grants_grantor ON friend_grants(grantor_id);
CREATE INDEX IF NOT EXISTS idx_friend_grants_grantee ON friend_grants(grantee_id);
