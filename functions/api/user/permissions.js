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
            const url = new URL(request.url);
            const userId = url.searchParams.get('userId') || currentUserId;
            const result = await db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').bind(userId).all();
            return new Response(JSON.stringify({ code: 0, data: (result.results || []).map(p => ({ permission: p.permission, grantedBy: p.granted_by })) }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { userId, permissions } = body;
            if (!userId || !Array.isArray(permissions)) return new Response(JSON.stringify({ code: -1, message: '参数错误' }), { status: 400, headers: { 'content-type': 'application/json' } });
            await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(userId).run();
            for (const perm of permissions) {
                await db.prepare('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)').bind(userId, perm, currentUserId).run();
            }
            return new Response(JSON.stringify({ code: 0, message: '权限更新成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
