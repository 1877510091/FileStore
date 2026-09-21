import { getSessionUser } from '../../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;
    const uid = params.uid;

    if (request.method !== 'DELETE') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const myRole = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
    if (!myRole || !['owner', 'admin'].includes(myRole.role)) return json({ code: -1, message: '无权限' }, 403);

    const targetRole = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, uid).first();
    if (!targetRole) return json({ code: -1, message: '该用户不在组中' }, 404);
    if (targetRole.role === 'owner') return json({ code: -1, message: '不能移除群主' }, 400);
    if (targetRole.role === 'admin' && myRole.role !== 'owner') return json({ code: -1, message: '管理员不能移除其他管理员' }, 403);

    await db.prepare('DELETE FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, uid).run();

    return json({ code: 0, message: '已移除' });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
