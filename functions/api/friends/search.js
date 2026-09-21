export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';

    const cookies = request.headers.get('Cookie') || '';
    const sessionMatch = cookies.match(/user_session=([^;]+)/);
    let currentUserId = null;
    if (sessionMatch) {
        try {
            const sessionData = await db.prepare('SELECT value FROM other_data WHERE key = ?').bind('manage@session@user_' + sessionMatch[1]).first();
            if (sessionData) { const p = JSON.parse(sessionData.value); currentUserId = p.userId; }
        } catch (e) {}
    }

    if (request.method === 'GET') {
        try {
            if (!q || q.length < 1) return new Response(JSON.stringify({ code: 0, data: [] }), { headers: { 'content-type': 'application/json' } });
            const result = await db.prepare("SELECT id, username, display_name, avatar FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? AND status = 'active' LIMIT 20").bind('%' + q + '%', '%' + q + '%', currentUserId || '').all();
            return new Response(JSON.stringify({ code: 0, data: (result.results || []).map(u => ({ id: u.id, username: u.username, displayName: u.display_name || '', avatar: u.avatar || '' })) }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
