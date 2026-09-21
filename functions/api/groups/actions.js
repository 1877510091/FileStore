import { getSessionUser } from '../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    if (request.method === 'GET' && action === 'search') {
        const me = await getSessionUser(env, request);
        if (!me) return json({ code: -1, message: '未登录' }, 401);
        const code = (url.searchParams.get('code') || '').trim();
        if (!code) return json({ code: -1, message: '请输入组号' }, 400);
        const group = await db.prepare('SELECT id, name, avatar, group_code FROM groups WHERE group_code = ?').bind(code).first();
        if (!group) return json({ code: -1, message: '未找到该组' }, 404);
        const memberCount = await db.prepare('SELECT COUNT(*) as cnt FROM user_groups WHERE group_id = ?').bind(group.id).first();
        const myMembership = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(group.id, me.id).first();
        return json({ code: 0, data: {
            id: group.id, name: group.name, avatar: group.avatar || '',
            groupCode: group.group_code, memberCount: memberCount ? memberCount.cnt : 0,
            joined: !!myMembership, myRole: myMembership ? myMembership.role : '',
        }});
    }

    if (request.method === 'POST' && action === 'join') {
        const me = await getSessionUser(env, request);
        if (!me) return json({ code: -1, message: '未登录' }, 401);
        const body = await request.json().catch(() => ({}));
        const groupId = body.groupId || '';
        if (!groupId) return json({ code: -1, message: '缺少组ID' }, 400);
        const group = await db.prepare('SELECT id, name FROM groups WHERE id = ?').bind(groupId).first();
        if (!group) return json({ code: -1, message: '组不存在' }, 404);
        const existing = await db.prepare('SELECT role FROM user_groups WHERE group_id = ? AND user_id = ?').bind(groupId, me.id).first();
        if (existing) return json({ code: -1, message: '你已在该组中' }, 400);
        const ugId = 'ug_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await db.prepare('INSERT INTO user_groups (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind(ugId, groupId, me.id, 'member').run();
        return json({ code: 0, message: '已加入组', data: { groupId, groupName: group.name } });
    }

    if (request.method === 'POST') {
        const me = await getSessionUser(env, request);
        if (!me) return json({ code: -1, message: '未登录' }, 401);
        const body = await request.json().catch(() => ({}));
        const name = (body.name || '').trim();
        if (!name) return json({ code: -1, message: '请输入组名' }, 400);
        let groupCode = body.groupCode || '';
        if (groupCode) {
            if (!/^\d{6}$/.test(groupCode)) return json({ code: -1, message: '组号必须为6位纯数字' }, 400);
            const exists = await db.prepare('SELECT id FROM groups WHERE group_code = ?').bind(groupCode).first();
            if (exists) return json({ code: -1, message: '该组号已被使用' }, 400);
        } else {
            for (let i = 0; i < 10; i++) {
                groupCode = String(Math.floor(100000 + Math.random() * 900000));
                const exists = await db.prepare('SELECT id FROM groups WHERE group_code = ?').bind(groupCode).first();
                if (!exists) break;
                if (i === 9) return json({ code: -1, message: '组号生成失败，请手动输入' }, 500);
            }
        }
        const groupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const avatar = body.avatar || '';
        const defaultUpload = body.defaultUpload || 'on';
        await db.prepare('INSERT INTO groups (id, name, description, avatar, owner_id, group_code, default_upload) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(groupId, name, '', avatar, me.id, groupCode, defaultUpload).run();
        await db.prepare('INSERT INTO user_groups (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind('ug_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), groupId, me.id, 'owner').run();
        const inviteIds = body.inviteIds || [];
        for (const uid of inviteIds) {
            if (uid === me.id) continue;
            const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
            if (!u) continue;
            await db.prepare('INSERT OR IGNORE INTO user_groups (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind('ug_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), groupId, uid, 'member').run();
        }
        return json({ code: 0, data: { id: groupId, name, groupCode, defaultUpload } });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
