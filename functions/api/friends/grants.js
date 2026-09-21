/**
 * 好友整盘授权 API
 * GET    : 我授权给谁 / 谁授权给我
 * POST   : 授权某好友查看或管理我的网盘
 * DELETE : 撤销授权
 */
import { getSessionUser } from '../../utils/auth/currentUser.js';

const VALID_PERMISSIONS = ['read', 'manage'];

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    if (request.method === 'GET') {
        const grantedByMe = await db
            .prepare('SELECT fg.*, u.username, u.display_name, u.avatar FROM friend_grants fg JOIN users u ON fg.grantee_id = u.id WHERE fg.grantor_id = ? ORDER BY fg.created_at DESC')
            .bind(me.id)
            .all();
        const grantedToMe = await db
            .prepare('SELECT fg.*, u.username, u.display_name, u.avatar FROM friend_grants fg JOIN users u ON fg.grantor_id = u.id WHERE fg.grantee_id = ? ORDER BY fg.created_at DESC')
            .bind(me.id)
            .all();

        return json({
            code: 0,
            data: {
                grantedByMe: (grantedByMe.results || []).map(mapGrant),
                grantedToMe: (grantedToMe.results || []).map(mapGrant),
            }
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const { granteeId, permissions } = body;

        if (!granteeId) return json({ code: -1, message: '缺少好友ID' }, 400);
        if (granteeId === me.id) return json({ code: -1, message: '不能授权给自己' }, 400);

        const perms = (Array.isArray(permissions) ? permissions : [permissions])
            .filter(p => VALID_PERMISSIONS.includes(p));
        if (perms.length === 0) return json({ code: -1, message: '至少选择一项权限' }, 400);

        const id = 'fg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await db
            .prepare('INSERT INTO friend_grants (id, grantor_id, grantee_id, permissions) VALUES (?, ?, ?, ?) ON CONFLICT(grantor_id, grantee_id) DO UPDATE SET permissions = excluded.permissions')
            .bind(id, me.id, granteeId, perms.join(','))
            .run();

        return json({ code: 0, message: '授权已生效' });
    }

    if (request.method === 'DELETE') {
        const url = new URL(request.url);
        const granteeId = url.searchParams.get('granteeId');
        if (!granteeId) return json({ code: -1, message: '缺少好友ID' }, 400);

        await db.prepare('DELETE FROM friend_grants WHERE grantor_id = ? AND grantee_id = ?').bind(me.id, granteeId).run();
        return json({ code: 0, message: '已撤销授权' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function mapGrant(g) {
    return {
        grantorId: g.grantor_id,
        granteeId: g.grantee_id,
        username: g.username,
        displayName: g.display_name || '',
        avatar: g.avatar || '',
        permissions: (g.permissions || '').split(',').filter(Boolean),
        createdAt: g.created_at,
    };
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
