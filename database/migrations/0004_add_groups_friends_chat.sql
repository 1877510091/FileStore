-- Add groups, friends, chat, shares, permissions, storage allocation tables

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    owner_id TEXT NOT NULL,
    max_storage_bytes INTEGER DEFAULT 0,
    storage_channel TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);

-- Add group_id to users table
ALTER TABLE users ADD COLUMN group_id TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN note TEXT DEFAULT '';

-- Friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    message TEXT DEFAULT '',
    file_share_id TEXT DEFAULT '',
    message_type TEXT DEFAULT 'text',
    is_read BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_receiver ON chat_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

-- File shares table
CREATE TABLE IF NOT EXISTS file_shares (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    shared_by TEXT NOT NULL,
    shared_with TEXT DEFAULT '',
    share_type TEXT DEFAULT 'link',
    permissions TEXT DEFAULT 'read',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shares_file ON file_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_shares_by ON file_shares(shared_by);
CREATE INDEX IF NOT EXISTS idx_shares_with ON file_shares(shared_with);

-- User permissions table
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    granted_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, permission)
);

-- User storage allocation table
CREATE TABLE IF NOT EXISTS user_storage (
    user_id TEXT PRIMARY KEY,
    quota_bytes INTEGER DEFAULT 0,
    storage_channel TEXT DEFAULT '',
    used_bytes INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT DEFAULT '',
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    file_id TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    details TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_group ON activity_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
