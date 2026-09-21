export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    if (request.method === 'GET') {
        try {
            const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first();
            if (!group) return new Response(JSON.stringify({ code: -1, message: '组不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });
            const members = await db.prepare("SELECT id, username, display_name, avatar, role, status, note FROM users WHERE group_id = ?").bind(groupId).all();
            return new Response(JSON.stringify({ code: 0, data: { id: group.id, name: group.name, description: group.description || '', avatar: group.avatar || '', ownerId: group.owner_id, maxStorageBytes: group.max_storage_bytes || 0, storageChannel: group.storage_channel || '', members: (members.results || []).map(m => ({ id: m.id, username: m.username, displayName: m.display_name || '', avatar: m.avatar || '', role: m.role, status: m.status, note: m.note || '' })), createdAt: group.created_at } }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'PUT') {
        try {
            const body = await request.json();
            const { name, description, avatar, maxStorageBytes, storageChannel } = body;
            const existing = await db.prepare('SELECT id FROM groups WHERE id = ?').bind(groupId).first();
            if (!existing) return new Response(JSON.stringify({ code: -1, message: '组不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });
            if (name !== undefined) await db.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, groupId).run();
            if (description !== undefined) await db.prepare('UPDATE groups SET description = ? WHERE id = ?').bind(description, groupId).run();
            if (avatar !== undefined) await db.prepare('UPDATE groups SET avatar = ? WHERE id = ?').bind(avatar, groupId).run();
            if (maxStorageBytes !== undefined) await db.prepare('UPDATE groups SET max_storage_bytes = ? WHERE id = ?').bind(maxStorageBytes, groupId).run();
            if (storageChannel !== undefined) await db.prepare('UPDATE groups SET storage_channel = ? WHERE id = ?').bind(storageChannel, groupId).run();
            return new Response(JSON.stringify({ code: 0, message: '组更新成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'DELETE') {
        try {
            await db.prepare("UPDATE users SET group_id = '' WHERE group_id = ?").bind(groupId).run();
            await db.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run();
            return new Response(JSON.stringify({ code: 0, message: '组删除成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
