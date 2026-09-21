import { getSessionUser } from '../../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    if (request.method !== 'POST') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const membership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!membership) return json({ code: -1, message: '你不在该组中' }, 403);

    const body = await request.json().catch(() => ({}));
    const fileId = body.fileId || '';
    if (!fileId) return json({ code: -1, message: '缺少文件ID' }, 400);

    const file = await db.prepare('SELECT id, fileName FROM files WHERE id = ?').bind(fileId).first();
    if (!file) return json({ code: -1, message: '文件不存在' }, 404);

    const shareId = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await db.prepare('INSERT INTO file_shares (id, file_id, shared_by, share_type, permissions) VALUES (?, ?, ?, ?, ?)').bind(shareId, fileId, me.id, 'group', 'read').run();

    const msgResult = await db.prepare(
        'INSERT INTO chat_messages (sender_id, receiver_id, group_id, message, file_share_id, message_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(me.id, '', groupId, '分享了文件: ' + (file.fileName || ''), shareId, 'file').run();

    return json({ code: 0, data: { shareId, messageId: msgResult.meta?.last_row_id } });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
