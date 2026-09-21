import { getSessionUser } from '../../../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;
    const uid = params.uid;

    if (request.method !== 'PUT') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const myRole = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!myRole || myRole.role !== 'owner') return json({ code: -1, message: '只有群主可以设置角色' }, 403);

    const body = await request.json().catch(() => ({}));
    const newRole = body.role;
    if (!['admin', 'member'].includes(newRole)) return json({ code: -1, message: '无效的角色' }, 400);

    const target = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, uid).first();
    if (!target) return json({ code: -1, message: '该用户不在组中' }, 404);

    await db.prepare('UPDATE user_groups SET role = ? WHERE group_id = ? AND user_id = ?').bind(newRole, groupId, uid).run();

    return json({ code: 0, message: '已设置角色' });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
