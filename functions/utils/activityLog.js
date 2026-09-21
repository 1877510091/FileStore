/**
 * 操作日志
 * 统一写入 activity_logs，并负责 90 天保留策略
 */
import { readUserSession } from './auth/currentUser.js';

export const ACTIVITY_RETENTION_DAYS = 90;

// 写入一条操作日志；groupId 从 user_groups 表获取（取第一个组，兼容旧逻辑）
export async function logActivity(env, { userId, action, fileId = '', fileName = '', details = '', ip = '', groupId = '' }) {
    if (!userId || !action) return;

    const db = env.img_d1;
    if (!groupId) {
        const userGroup = await db.prepare('SELECT group_id FROM user_groups WHERE user_id = ? LIMIT 1').bind(userId).first();
        groupId = userGroup ? userGroup.group_id : '';
    }

    await db
        .prepare('INSERT INTO activity_logs (group_id, user_id, action, file_id, file_name, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(groupId, userId, action, fileId, fileName, details, ip)
        .run();
}

// 带请求上下文的日志写入：自动解析当前登录用户与 IP
export async function logRequestActivity(env, request, action, { fileId = '', fileName = '', details = '' } = {}) {
    const session = await readUserSession(env, request);
    if (!session) return;
    const ip = request.headers.get('cf-connecting-ip') || '';
    await logActivity(env, { userId: session.userId, action, fileId, fileName, details, ip });
}

// 清理超过保留期的日志
export async function purgeExpiredActivityLogs(env) {
    await env.img_d1
        .prepare(`DELETE FROM activity_logs WHERE created_at < datetime('now', '-${ACTIVITY_RETENTION_DAYS} days')`)
        .run();
}
