import { getSessionUser } from '../../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const membership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!membership) return json({ code: -1, message: '你不在该组中' }, 403);

    if (request.method === 'GET') {
        const result = await db.prepare(
            'SELECT gos.user_id, gos.status, gos.last_seen, u.username, u.display_name, u.avatar FROM group_online_status gos JOIN users u ON gos.user_id = u.id WHERE gos.group_id = ?'
        ).bind(groupId).all();

        return json({ code: 0, data: { online: (result.results || []).map(o => ({
            userId: o.user_id, status: o.status, lastSeen: o.last_seen,
            username: o.username, displayName: o.display_name || o.username, avatar: o.avatar || '',
        }))}});
    }

    if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const status = body.status || 'online';
        if (!['online', 'invisible', 'offline'].includes(status)) return json({ code: -1, message: '无效状态' }, 400);

        await db.prepare(
            'INSERT INTO group_online_status (group_id, user_id, status, last_seen) VALUES (?, ?, ?, datetime("now")) ON CONFLICT(group_id, user_id) DO UPDATE SET status = ?, last_seen = datetime("now")'
        ).bind(groupId, me.id, status, status).run();

        return json({ code: 0, message: '已更新' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
