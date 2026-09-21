/**
 * 操作日志查询 API
 * 管理员：可查全部或指定组；普通用户：只查自己所在组（无组则只查自己）
 * 每次查询顺带清理超过 90 天的记录
 */
import { purgeExpiredActivityLogs } from '../../utils/activityLog.js';
import { getSessionUser, isAdminRequest } from '../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    if (request.method !== 'GET') {
        return json({ code: -1, message: 'Method not allowed' }, 405);
    }

    // 网盘会话（user_session）或管理后台会话（admin_session）都可以查日志：
    // 管理后台只有 admin_session，若只认 user_session 会导致后台日志页永远「未登录」
    let me = await getSessionUser(env, request);
    if (!me) {
        const adminOk = await isAdminRequest(env, request);
        if (!adminOk) return json({ code: -1, message: '未登录' }, 401);
        me = { id: '', username: 'admin', role: 'admin', groupId: '' };
    }

    await purgeExpiredActivityLogs(env);

    const url = new URL(request.url);
    const groupId = url.searchParams.get('groupId') || '';
    const userId = url.searchParams.get('userId') || '';
    const action = url.searchParams.get('action') || '';
    const start = parseInt(url.searchParams.get('start') || '0', 10);
    const count = parseInt(url.searchParams.get('count') || '50', 10);

    let where = '';
    const params = [];

    if (me.role === 'admin') {
        if (groupId) { where += ' AND al.group_id = ?'; params.push(groupId); }
    } else if (me.groupId) {
        where += ' AND al.group_id = ?';
        params.push(me.groupId);
    } else {
        where += ' AND al.user_id = ?';
        params.push(me.id);
    }

    if (userId) { where += ' AND al.user_id = ?'; params.push(userId); }
    if (action) { where += ' AND al.action = ?'; params.push(action); }

    const countRow = await db
        .prepare(`SELECT COUNT(*) AS total FROM activity_logs al WHERE 1=1 ${where}`)
        .bind(...params)
        .first();

    const result = await db
        .prepare(`SELECT al.*, u.username, u.display_name, u.avatar FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1 ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...params, count, start)
        .all();

    return json({
        code: 0,
        data: {
            logs: (result.results || []).map(l => ({
                id: l.id,
                groupId: l.group_id,
                userId: l.user_id,
                username: l.username || '',
                displayName: l.display_name || '',
                avatar: l.avatar || '',
                action: l.action,
                fileId: l.file_id || '',
                fileName: l.file_name || '',
                details: l.details || '',
                ipAddress: l.ip_address || '',
                createdAt: l.created_at,
            })),
            total: countRow ? countRow.total : 0,
            start,
            count,
            retentionDays: 90,
        }
    });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
