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
        const url = new URL(request.url);
        const sinceId = parseInt(url.searchParams.get('sinceId') || '0', 10);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);

        let query = 'SELECT cm.*, u.username, u.display_name, u.avatar FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id WHERE cm.group_id = ?';
        const binds = [groupId];

        if (sinceId > 0) {
            query += ' AND cm.id > ?';
            binds.push(sinceId);
        }

        query += ' ORDER BY cm.id DESC LIMIT ?';
        binds.push(limit);

        const result = await db.prepare(query).bind(...binds).all();

        return json({ code: 0, data: { messages: (result.results || []).reverse().map(m => ({
            id: m.id, senderId: m.sender_id, username: m.username,
            displayName: m.display_name || m.username, avatar: m.avatar || '',
            message: m.message || '', fileShareId: m.file_share_id || '',
            messageType: m.message_type || 'text', createdAt: m.created_at,
        }))}});
    }

    if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const message = (body.message || '').trim();
        const fileShareId = body.fileShareId || '';
        const messageType = body.messageType || 'text';

        if (!message && !fileShareId) return json({ code: -1, message: '消息内容不能为空' }, 400);

        const result = await db.prepare(
            'INSERT INTO chat_messages (sender_id, receiver_id, group_id, message, file_share_id, message_type) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(me.id, '', groupId, message, fileShareId, messageType).run();

        return json({ code: 0, data: { id: result.meta?.last_row_id } });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
