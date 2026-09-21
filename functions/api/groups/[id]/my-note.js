import { getSessionUser } from '../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    if (request.method !== 'PUT') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const membership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!membership) return json({ code: -1, message: '你不在该组中' }, 403);

    const body = await request.json().catch(() => ({}));
    const note = (body.note || '').trim();

    await db.prepare('UPDATE user_groups SET note = ? WHERE group_id = ? AND user_id = ?').bind(note, groupId, me.id).run();

    return json({ code: 0, message: '已更新备注' });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
