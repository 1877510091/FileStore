-- 用户-组关联表（一个用户可加入多个组）
CREATE TABLE IF NOT EXISTS user_groups (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  share_personal_files INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ug_group ON user_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_ug_user ON user_groups(user_id);

-- 组在线状态
CREATE TABLE IF NOT EXISTS group_online_status (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT DEFAULT 'online',
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, user_id)
);

-- groups 表新增字段
ALTER TABLE groups ADD COLUMN group_code TEXT DEFAULT '';
ALTER TABLE groups ADD COLUMN default_upload TEXT DEFAULT 'on';

-- friendships 表新增备注字段
ALTER TABLE friendships ADD COLUMN note TEXT DEFAULT '';

-- chat_messages 表支持群聊
ALTER TABLE chat_messages ADD COLUMN group_id TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_chat_group ON chat_messages(group_id);
