export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    const cookies = request.headers.get('Cookie') || '';
    const sessionMatch = cookies.match(/user_session=([^;]+)/);
    if (!sessionMatch) return new Response(JSON.stringify({ code: -1, message: '未登录' }), { status: 401, headers: { 'content-type': 'application/json' } });

    let userId = null;
    try {
        const sessionData = await db.prepare('SELECT value FROM other_data WHERE key = ?').bind('manage@session@user_' + sessionMatch[1]).first();
        if (sessionData) { const parsed = JSON.parse(sessionData.value); userId = parsed.userId; }
    } catch (e) {}
    if (!userId) return new Response(JSON.stringify({ code: -1, message: '会话无效' }), { status: 401, headers: { 'content-type': 'application/json' } });

    if (request.method === 'GET') {
        try {
            const user = await db.prepare('SELECT id, username, display_name, avatar, role, status, group_id, created_at FROM users WHERE id = ?').bind(userId).first();
            if (!user) return new Response(JSON.stringify({ code: -1, message: '用户不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify({ code: 0, data: { id: user.id, username: user.username, displayName: user.display_name || '', avatar: user.avatar || '', role: user.role || 'user', status: user.status || 'active', groupId: user.group_id || '', createdAt: user.created_at } }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { displayName, avatar, username } = body;
            if (username !== undefined) {
                if (username.length < 2 || username.length > 32) return new Response(JSON.stringify({ code: -1, message: '用户名长度需在2-32之间' }), { status: 400, headers: { 'content-type': 'application/json' } });
                const existing = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(username, userId).first();
                if (existing) return new Response(JSON.stringify({ code: -1, message: '用户名已存在' }), { status: 400, headers: { 'content-type': 'application/json' } });
                await db.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, userId).run();
            }
            if (displayName !== undefined) await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, userId).run();
            if (avatar !== undefined) await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(avatar, userId).run();
            return new Response(JSON.stringify({ code: 0, message: '个人信息更新成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
