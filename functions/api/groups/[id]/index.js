import { getSessionUser } from '../../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const groupId = params.id;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    if (request.method === 'GET') {
        const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first();
        if (!group) return json({ code: -1, message: '组不存在' }, 404);

        const myMembership = await db.prepare('SELECT role, share_personal_files, note FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
        if (!myMembership) return json({ code: -1, message: '你不在该组中' }, 403);

        const members = await db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar, ug.role, ug.share_personal_files, ug.note, ug.joined_at,
                   (SELECT status FROM group_online_status WHERE group_id = ? AND user_id = u.id) as online_status
            FROM user_groups ug JOIN users u ON ug.user_id = u.id
            WHERE ug.group_id = ?
            ORDER BY CASE ug.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, ug.joined_at ASC
        `).bind(groupId, groupId).all();

        return json({ code: 0, data: {
            id: group.id,
            name: group.name,
            description: group.description || '',
            avatar: group.avatar || '',
            groupCode: group.group_code || '',
            defaultUpload: group.default_upload || 'on',
            ownerId: group.owner_id,
            myRole: myMembership.role,
            mySharePersonal: myMembership.share_personal_files,
            myNote: myMembership.note || '',
            members: (members.results || []).map(m => ({
                id: m.id,
                username: m.username,
                displayName: m.display_name || m.username,
                avatar: m.avatar || '',
                role: m.role,
                sharePersonalFiles: m.share_personal_files,
                note: m.note || '',
                onlineStatus: m.online_status || 'offline',
                joinedAt: m.joined_at,
            })),
        }});
    }

    if (request.method === 'PUT') {
        const myMembership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
        if (!myMembership) return json({ code: -1, message: '你不在该组中' }, 403);
        if (!['owner', 'admin'].includes(myMembership.role)) return json({ code: -1, message: '无权限' }, 403);

        const body = await request.json().catch(() => ({}));
        const updates = [];
        const binds = [];

        if (body.name !== undefined) {
            updates.push('name = ?');
            binds.push(body.name.trim());
        }
        if (body.groupCode !== undefined) {
            const code = body.groupCode.trim();
            if (!/^\d{6}$/.test(code)) return json({ code: -1, message: '组号必须为6位纯数字' }, 400);
            const exists = await db.prepare('SELECT id FROM groups WHERE group_code = ? AND id != ?').bind(code, groupId).first();
            if (exists) return json({ code: -1, message: '该组号已被使用' }, 400);
            updates.push('group_code = ?');
            binds.push(code);
        }
        if (body.avatar !== undefined) {
            updates.push('avatar = ?');
            binds.push(body.avatar);
        }
        if (body.defaultUpload !== undefined) {
            updates.push('default_upload = ?');
            binds.push(body.defaultUpload);
        }
        if (body.description !== undefined) {
            updates.push('description = ?');
            binds.push(body.description);
        }

        if (updates.length === 0) return json({ code: -1, message: '无更新内容' }, 400);

        binds.push(groupId);
        await db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

        return json({ code: 0, message: '已更新' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
