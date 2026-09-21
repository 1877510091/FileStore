export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    if (request.method === 'GET') {
        try {
            const result = await db.prepare('SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS member_count FROM groups g ORDER BY g.created_at DESC').all();
            const groups = (result.results || []).map(g => ({
                id: g.id, name: g.name, description: g.description || '',
                avatar: g.avatar || '', ownerId: g.owner_id,
                maxStorageBytes: g.max_storage_bytes || 0,
                storageChannel: g.storage_channel || '',
                memberCount: g.member_count || 0,
                createdAt: g.created_at, updatedAt: g.updated_at,
            }));
            return new Response(JSON.stringify({ code: 0, data: groups }), { headers: { 'content-type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
        }
    }

    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { name, description, maxStorageBytes, storageChannel } = body;
            if (!name) return new Response(JSON.stringify({ code: -1, message: '组名不能为空' }), { status: 400, headers: { 'content-type': 'application/json' } });

            const existing = await db.prepare('SELECT id FROM groups WHERE name = ?').bind(name).first();
            if (existing) return new Response(JSON.stringify({ code: -1, message: '组名已存在' }), { status: 400, headers: { 'content-type': 'application/json' } });

            const id = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            await db.prepare('INSERT INTO groups (id, name, description, owner_id, max_storage_bytes, storage_channel) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, description || '', 'admin', maxStorageBytes || 0, storageChannel || '').run();

            return new Response(JSON.stringify({ code: 0, message: '组创建成功', data: { id, name } }), { headers: { 'content-type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
        }
    }
    return new Response('Method not allowed', { status: 405 });
}
