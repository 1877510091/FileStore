import { getSessionUser } from '../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    if (request.method !== 'GET') return json({ code: -1, message: 'Method not allowed' }, 405);

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    let groupRows;
    if (me.role === 'admin') {
        groupRows = await db.prepare('SELECT g.*, ug.role as my_role, ug.share_personal_files, ug.note as my_note FROM groups g LEFT JOIN user_groups ug ON g.id = ug.group_id AND ug.user_id = ? ORDER BY g.created_at ASC').bind(me.id).all();
    } else {
        groupRows = await db.prepare('SELECT g.*, ug.role as my_role, ug.share_personal_files, ug.note as my_note FROM groups g JOIN user_groups ug ON g.id = ug.group_id WHERE ug.user_id = ? ORDER BY g.created_at ASC').bind(me.id).all();
    }

    const groups = [];
    for (const g of (groupRows.results || [])) {
        const members = await db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar, ug.role, ug.note,
                   (SELECT status FROM group_online_status WHERE group_id = ? AND user_id = u.id) as online_status
            FROM user_groups ug JOIN users u ON ug.user_id = u.id
            WHERE ug.group_id = ?
            ORDER BY CASE ug.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, ug.joined_at ASC
        `).bind(g.id, g.id).all();

        groups.push({
            id: g.id,
            name: g.name,
            description: g.description || '',
            avatar: g.avatar || '',
            groupCode: g.group_code || '',
            defaultUpload: g.default_upload || 'on',
            ownerId: g.owner_id,
            myRole: g.my_role || 'member',
            mySharePersonal: g.share_personal_files || 0,
            myNote: g.my_note || '',
            members: (members.results || []).map(m => ({
                id: m.id,
                username: m.username,
                displayName: m.display_name || m.username,
                avatar: m.avatar || '',
                role: m.role,
                note: m.note || '',
                onlineStatus: m.online_status || 'offline',
            })),
        });
    }

    return json({ code: 0, data: { groups } });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
