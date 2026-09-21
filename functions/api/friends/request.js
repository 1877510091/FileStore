export async function onRequest(context) {
    const { request, env } = context;
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

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { friendId } = body;
            if (!friendId) return new Response(JSON.stringify({ code: -1, message: '缺少好友ID' }), { status: 400, headers: { 'content-type': 'application/json' } });
            if (friendId === currentUserId) return new Response(JSON.stringify({ code: -1, message: '不能添加自己为好友' }), { status: 400, headers: { 'content-type': 'application/json' } });

            const existing = await db.prepare('SELECT id FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').bind(currentUserId, friendId, friendId, currentUserId).first();
            if (existing) return new Response(JSON.stringify({ code: -1, message: '已经是好友或请求已发送' }), { status: 400, headers: { 'content-type': 'application/json' } });

            const id = 'fr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            await db.prepare('INSERT INTO friendships (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)').bind(id, currentUserId, friendId, 'pending').run();
            return new Response(JSON.stringify({ code: 0, message: '好友请求已发送' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
