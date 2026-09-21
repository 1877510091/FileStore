-- 0008_add_user_created_by.sql
-- users 增加 created_by：记录「创建该账号的管理员 id」，据此形成管理员上下级树。
-- 规则：只能管理自己创建的管理员及其无限下级（任意上级祖先）；
--       不能修改自己，也不能修改同级或无关分支；created_by 为空表示根管理员（无上级，任何人都不能修改它）。
-- 普通用户（role != 'admin'）不设层级限制，管理员可正常管理。

ALTER TABLE users ADD COLUMN created_by TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
