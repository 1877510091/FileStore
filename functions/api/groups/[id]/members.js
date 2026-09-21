import { getSessionUser } from '../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    if (request.method !== 'GET') return json({ code: -1, message: 'Method not allowed' }, 405);

    const membership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!membership) return json({ code: -1, message: '你不在该组中' }, 403);

    const members = await db.prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar, ug.role, ug.note, ug.joined_at,
               (SELECT status FROM group_online_status WHERE group_id = ? AND user_id = u.id) as online_status
        FROM user_groups ug JOIN users u ON ug.user_id = u.id
        WHERE ug.group_id = ?
        ORDER BY CASE ug.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, ug.joined_at ASC
    `).bind(groupId, groupId).all();

    return json({ code: 0, data: { members: (members.results || []).map(m => ({
        id: m.id, username: m.username, displayName: m.display_name || m.username,
        avatar: m.avatar || '', role: m.role, note: m.note || '',
        onlineStatus: m.online_status || 'offline', joinedAt: m.joined_at,
    }))}});
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
