export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    if (request.method === 'GET') {
        try {
            const members = await db.prepare("SELECT id, username, display_name, avatar, role, status, note, created_at FROM users WHERE group_id = ?").bind(groupId).all();
            return new Response(JSON.stringify({ code: 0, data: (members.results || []).map(m => ({ id: m.id, username: m.username, displayName: m.display_name || '', avatar: m.avatar || '', role: m.role, status: m.status, note: m.note || '', createdAt: m.created_at })) }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { userId } = body;
            if (!userId) return new Response(JSON.stringify({ code: -1, message: '缺少用户ID' }), { status: 400, headers: { 'content-type': 'application/json' } });
            await db.prepare('UPDATE users SET group_id = ? WHERE id = ?').bind(groupId, userId).run();
            return new Response(JSON.stringify({ code: 0, message: '成员添加成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
