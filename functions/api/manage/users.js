import { hashPassword } from '../../utils/auth/passwordHash.js';
import { resolveOperator, canManageTarget } from '../../utils/auth/adminHierarchy.js';
import { getAllUserChannelQuotas, setUserChannelQuotas, storageModeOf } from '../../utils/userChannelQuota.js';

/**
 * 用户管理 API
 * GET : 用户列表（含组名与存储配额）
 * POST: 新建用户；未指定组时自动建一个新组，并可直接分配独立存储
 */
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    if (request.method === 'GET') {
        const result = await db
            .prepare('SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.status, u.group_id, u.note, u.created_by, u.created_at, g.name AS group_name, s.quota_bytes, s.storage_channel FROM users u LEFT JOIN groups g ON u.group_id = g.id LEFT JOIN user_storage s ON u.id = s.user_id ORDER BY u.created_at DESC')
            .all();

        const operator = await resolveOperator(env, request);
        const quotaMap = await getAllUserChannelQuotas(env);
        const users = [];
        for (const u of (result.results || [])) {
            const cm = await canManageTarget(env, operator, u.id);
            const cq = quotaMap.get(u.id) || [];
            users.push({
                id: u.id,
                username: u.username,
                displayName: u.display_name || '',
                avatar: u.avatar || '',
                role: u.role || 'user',
                status: u.status || 'active',
                groupId: u.group_id || '',
                groupName: u.group_name || '',
                note: u.note || '',
                quotaBytes: u.quota_bytes || 0,
                storageChannel: u.storage_channel || '',
                storageMode: storageModeOf(cq),
                channelQuotas: cq,
                createdBy: u.created_by || '',
                canManage: cm.allowed,
                manageReason: cm.reason,
                createdAt: u.created_at,
            });
        }

        return json({ code: 0, data: users, operatorId: operator ? operator.id : '' });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const { username, password, displayName, role, groupId, avatar, note, storageMode, channelQuotas } = body;

        if (!username) return json({ code: -1, message: '用户名不能为空' }, 400);
        if (username.length < 2 || username.length > 32) return json({ code: -1, message: '用户名长度需在2-32之间' }, 400);

        const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        if (existing) return json({ code: -1, message: '用户名已存在' }, 400);

        const userRole = role === 'admin' ? 'admin' : 'user';
        const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        // 管理员必须设密码，普通用户仅用户名登录、没有密码
        let hashedPassword = '';
        if (userRole === 'admin') {
            if (!password || password.length < 4) return json({ code: -1, message: '管理员密码长度不能少于4位' }, 400);
            hashedPassword = await hashPassword(password);
        }

        // 所属组：不选则不加入任何组（不再自动创建新组）
        const resolvedGroupId = groupId || '';

        // 记录创建者，形成管理员上下级（普通用户也记录归属，便于日后追溯）
        const operator = await resolveOperator(env, request);
        const createdBy = operator && operator.id ? operator.id : '';

        await db
            .prepare('INSERT INTO users (id, username, password, display_name, avatar, role, status, group_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, username, hashedPassword, displayName || username, avatar || '', userRole, 'active', resolvedGroupId, note || '', createdBy)
            .run();

        // 存储分配：默认「全部通道共享」（不写任何行）；选「自定义」时写入每通道三态配置
        if (storageMode === 'custom' && Array.isArray(channelQuotas) && channelQuotas.length > 0) {
            await setUserChannelQuotas(env, id, channelQuotas);
        }

        return json({
            code: 0,
            message: '用户创建成功',
            data: { id, username, displayName: displayName || username, role: userRole, groupId: resolvedGroupId }
        });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
