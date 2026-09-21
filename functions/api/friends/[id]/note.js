import { getSessionUser } from '../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const friendshipId = params.id;

    if (request.method !== 'PUT') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const body = await request.json().catch(() => ({}));
    const note = (body.note || '').trim();

    const friendship = await db.prepare('SELECT id FROM friendships WHERE id = ? AND (user_id = ? OR friend_id = ?)').bind(friendshipId, me.id, me.id).first();
    if (!friendship) return json({ code: -1, message: '好友关系不存在' }, 404);

    await db.prepare('UPDATE friendships SET note = ? WHERE id = ?').bind(note, friendshipId).run();

    return json({ code: 0, message: '已更新备注' });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
