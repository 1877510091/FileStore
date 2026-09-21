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

    if (request.method === 'GET') {
        try {
            const result = await db.prepare("SELECT sender_id, COUNT(*) as count FROM chat_messages WHERE receiver_id = ? AND is_read = 0 GROUP BY sender_id").bind(currentUserId).all();
            const unread = {};
            let total = 0;
            for (const row of (result.results || [])) {
                unread[row.sender_id] = row.count;
                total += row.count;
            }
            return new Response(JSON.stringify({ code: 0, data: { total, byUser: unread } }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { senderId } = body;
            if (senderId) {
                await db.prepare("UPDATE chat_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?").bind(senderId, currentUserId).run();
            } else {
                await db.prepare("UPDATE chat_messages SET is_read = 1 WHERE receiver_id = ?").bind(currentUserId).run();
            }
            return new Response(JSON.stringify({ code: 0, message: '已标记已读' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
