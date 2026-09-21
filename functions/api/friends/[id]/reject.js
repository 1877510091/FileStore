export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;

    const cookies = request.headers.get('Cookie') || '';
    const sessionMatch = cookies.match(/user_session=([^;]+)/);
    let currentUserId = null;
    if (sessionMatch) {
        try {
            const sessionData = await db.prepare('SELECT value FROM other_data WHERE key = ?').bind('manage@session@user_' + sessionMatch[1]).first();
            if (sessionData) { const p = JSON.parse(sessionData.value); currentUserId = p.userId; }
        } catch (e) {}
    }
    if (!currentUserId) return new Response(JSON.stringify({ code: -1, message: '未登录' }), { status: 401, headers: { 'content-type': 'application/json' } });

    if (request.method === 'POST' || request.method === 'DELETE') {
        try {
            await db.prepare('DELETE FROM friendships WHERE id = ?').bind(params.id).run();
            return new Response(JSON.stringify({ code: 0, message: '已拒绝/删除好友' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
