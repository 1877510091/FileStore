-- 0007_add_folders.sql
-- 显式创建的文件夹登记表。
-- 说明：文件所在的文件夹本身由 files 索引的 metadata.Directory 推导（有文件就自然存在），
-- 这张表只用来让「还没有文件的空文件夹」也能被持久化并出现在侧栏树里。
-- path 为完整路径且始终以 '/' 结尾（根目录表示为 ''）。

CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,
    parent_path TEXT NOT NULL DEFAULT '',
    owner_id    TEXT DEFAULT '',
    group_id    TEXT DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 同一范围内同一个路径只能有一条登记
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_scope_path ON folders(path, owner_id, group_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_path);
