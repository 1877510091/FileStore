/**
 * 当前登录用户解析
 * 统一从请求 Cookie 中解析 user_session，返回 users 表中的用户记录
 */
import { validateSession } from './sessionManager.js';

// 解析 user_session cookie
export function readUserSessionToken(request) {
    const cookies = request.headers.get('Cookie') || '';
    const match = cookies.match(/user_session=([^;]+)/);
    return match ? match[1] : null;
}

// 读取会话记录（存在 other_data 表中）
export async function readUserSession(env, request) {
    const token = readUserSessionToken(request);
    if (!token) return null;
    const row = await env.img_d1
        .prepare('SELECT value FROM other_data WHERE key = ?')
        .bind('manage@session@user_' + token)
        .first();
    if (!row) return null;
    const parsed = JSON.parse(row.value);
    return parsed && parsed.userId ? parsed : null;
}

// 返回当前登录用户（含组信息），未登录返回 null
export async function getSessionUser(env, request) {
    const session = await readUserSession(env, request);
    if (!session) return null;

    const user = await env.img_d1
        .prepare('SELECT id, username, display_name, avatar, role, status, group_id FROM users WHERE id = ?')
        .bind(session.userId)
        .first();
    if (!user) return null;
    // 被禁用的账号立即失效（即使会话凭证还没被清理）
    if ((user.status || 'active') !== 'active') return null;

    return {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        avatar: user.avatar || '',
        role: user.role || 'user',
        status: user.status || 'active',
        groupId: user.group_id || '',
    };
}

// 是否为管理员（admin session 或 admin 角色的 user session）
export async function isAdminRequest(env, request) {
    const adminSession = await validateSession(env, request, 'admin');
    if (adminSession.valid) return true;
    const user = await getSessionUser(env, request);
    return !!(user && user.role === 'admin');
}

// 文件可见范围：admin=全部；普通用户=自己 + 所有加入的组 + 好友授权
export async function resolveFileScope(env, request) {
    const user = await getSessionUser(env, request);
    if (!user) return { isAdmin: true, userId: '', groupId: '', groupIds: [], grantorIds: [] };

    if (user.role === 'admin') {
        return { isAdmin: true, userId: user.id, groupId: user.groupId, groupIds: [], grantorIds: [] };
    }

    const grants = await env.img_d1
        .prepare('SELECT grantor_id FROM friend_grants WHERE grantee_id = ?')
        .bind(user.id)
        .all();

    const userGroups = await env.img_d1
        .prepare('SELECT group_id FROM user_groups WHERE user_id = ?')
        .bind(user.id)
        .all();

    return {
        isAdmin: false,
        userId: user.id,
        groupId: user.groupId,
        groupIds: (userGroups.results || []).map(g => g.group_id),
        grantorIds: (grants.results || []).map(g => g.grantor_id),
    };
}
