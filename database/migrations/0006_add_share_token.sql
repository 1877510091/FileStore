-- 分享链接：token / 提取码 / 访问与下载统计
ALTER TABLE file_shares ADD COLUMN token TEXT;
ALTER TABLE file_shares ADD COLUMN code TEXT;
ALTER TABLE file_shares ADD COLUMN views INTEGER DEFAULT 0;
ALTER TABLE file_shares ADD COLUMN downloads INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_shares_token ON file_shares(token);
