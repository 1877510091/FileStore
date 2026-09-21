/**
 * 管理员层级（上下级）
 *
 * users.created_by 记录「创建该账号的管理员 id」，据此形成管理员树。
 * 权限规则（与用户约定一致）：
 *   - 只能管理「自己创建的管理员」以及它的无限下级（任意上级祖先都能管后代）
 *   - 不能修改自己
 *   - 不能修改同级（同一上级下）或无关分支
 *   - 根管理员（created_by 为空）没有上级，任何人都不能修改它
 *   - 普通用户（role !== 'admin'）不设层级限制，管理员可正常管理
 */
import { validateSession } from './sessionManager.js';
import { fetchSecurityConfig } from '../sysConfig.js';
import { getSessionUser } from './currentUser.js';

/**
 * 解析当前操作者。
 * 1) user_session 且 role=admin → 以该用户为操作者
 * 2) admin_session（全局管理员登录）→ 映射到 users 表中同名的 admin 记录
 * 3) 全局管理员在 users 表中找不到对应记录 → 视为「超级根」，可管理所有管理员
 *
 * @returns {Promise<{id:string, username:string, isSuperRoot:boolean}|null>} 未登录返回 null
 */
export async function resolveOperator(env, request) {
    // 1) 网盘会话中的管理员用户
    const user = await getSessionUser(env, request);
    if (user && user.role === 'admin') {
        return { id: user.id, username: user.username, isSuperRoot: false };
    }

    // 2) 管理后台会话（全局管理员）
    const adminSession = await validateSession(env, request, 'admin');
    if (adminSession.valid) {
        let adminUsername = '';
        try {
            const cfg = await fetchSecurityConfig(env);
            adminUsername = (cfg?.auth?.admin?.adminUsername || '').trim();
        } catch (e) {
            // 读取配置失败时按超级根处理
        }

        if (adminUsername) {
            const row = await env.img_d1
                .prepare("SELECT id, username FROM users WHERE username = ? AND role = 'admin'")
                .bind(adminUsername)
                .first();
            if (row) return { id: row.id, username: row.username, isSuperRoot: false };
        }

        // 全局管理员在 users 表里没有对应记录 → 超级根
        return { id: '', username: adminUsername || 'admin', isSuperRoot: true };
    }

    return null;
}

/**
 * 判断操作者能否管理目标用户。
 * @returns {Promise<{allowed:boolean, reason:string}>}
 */
export async function canManageTarget(env, operator, targetId) {
    if (!operator) return { allowed: false, reason: '未登录' };

    const target = await env.img_d1
        .prepare('SELECT id, username, role, created_by FROM users WHERE id = ?')
        .bind(targetId)
        .first();
    if (!target) return { allowed: false, reason: '用户不存在' };

    // 普通用户不设层级限制
    if ((target.role || 'user') !== 'admin') {
        return { allowed: true, reason: '' };
    }

    // 不能修改自己
    if (operator.id && operator.id === target.id) {
        return { allowed: false, reason: '不能修改自己' };
    }

    // 超级根（全局管理员未在 users 表中登记）可管理所有管理员
    if (operator.isSuperRoot) {
        return { allowed: true, reason: '' };
    }

    // 沿 created_by 向上追溯，若能命中操作者 → 操作者是目标的上级祖先
    let cur = target.created_by || '';
    const seen = new Set();
    while (cur) {
        if (cur === operator.id) return { allowed: true, reason: '' };
        if (seen.has(cur)) break; // 防御：数据异常时避免死循环
        seen.add(cur);
        const parent = await env.img_d1
            .prepare('SELECT created_by FROM users WHERE id = ?')
            .bind(cur)
            .first();
        cur = parent ? (parent.created_by || '') : '';
    }

    return { allowed: false, reason: '只有上级管理员可以修改该管理员' };
}
