import { hashPassword } from '../../../utils/auth/passwordHash.js';
import { resolveOperator, canManageTarget } from '../../../utils/auth/adminHierarchy.js';
import { destroyUserSessionsById } from '../../../utils/auth/sessionManager.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const userId = params.id;

    if (!userId) return new Response(JSON.stringify({ code: -1, message: '缺少用户ID' }), { status: 400, headers: { 'content-type': 'application/json' } });

    if (request.method === 'GET') {
        try {
            const user = await db.prepare('SELECT id, username, display_name, avatar, role, status, group_id, note, created_at, updated_at FROM users WHERE id = ?').bind(userId).first();
            if (!user) return new Response(JSON.stringify({ code: -1, message: '用户不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify({ code: 0, data: { id: user.id, username: user.username, displayName: user.display_name || '', avatar: user.avatar || '', role: user.role || 'user', status: user.status || 'active', groupId: user.group_id || '', note: user.note || '', createdAt: user.created_at, updatedAt: user.updated_at } }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'PUT') {
        try {
            const body = await request.json();
            const { password, displayName, avatar, role, status, groupId, note } = body;
            const existing = await db.prepare('SELECT id, role, created_by, status FROM users WHERE id = ?').bind(userId).first();
            if (!existing) return new Response(JSON.stringify({ code: -1, message: '用户不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });

            // 管理员层级校验：只有上级管理员能修改，且不能修改自己 / 同级 / 无关分支
            const operator = await resolveOperator(env, request);
            const cm = await canManageTarget(env, operator, userId);
            if (!cm.allowed) {
                return new Response(JSON.stringify({ code: -1, message: cm.reason }), { status: 403, headers: { 'content-type': 'application/json' } });
            }

            if (password) { const hp = await hashPassword(password); await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hp, userId).run(); }
            if (displayName !== undefined) await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, userId).run();
            if (avatar !== undefined) await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(avatar, userId).run();
            if (role !== undefined && ['admin', 'user'].includes(role)) {
                await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
                if (role === 'admin') {
                    // 升为管理员：归属当前操作者（若原本无归属）
                    if (!existing.created_by && operator && operator.id) {
                        await db.prepare('UPDATE users SET created_by = ? WHERE id = ?').bind(operator.id, userId).run();
                    }
                } else {
                    // 降为普通用户：其下级上提一级，避免出现无人能管的管理员
                    await db.prepare('UPDATE users SET created_by = ? WHERE created_by = ?').bind(existing.created_by || '', userId).run();
                }
            }
            if (status !== undefined && ['active', 'disabled'].includes(status)) {
                await db.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, userId).run();
                // 禁用后实时踢下线：清掉该用户的全部会话凭证与登录数据
                if (status === 'disabled' && (existing.status || 'active') === 'active') {
                    await destroyUserSessionsById(env, userId);
                }
            }
            if (groupId !== undefined) await db.prepare('UPDATE users SET group_id = ? WHERE id = ?').bind(groupId, userId).run();
            if (note !== undefined) await db.prepare('UPDATE users SET note = ? WHERE id = ?').bind(note, userId).run();

            return new Response(JSON.stringify({ code: 0, message: '用户更新成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (request.method === 'DELETE') {
        try {
            const existing = await db.prepare('SELECT id, role, created_by FROM users WHERE id = ?').bind(userId).first();
            if (!existing) return new Response(JSON.stringify({ code: -1, message: '用户不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });

            // 管理员层级校验：只有上级管理员能删除，且不能删除自己 / 同级 / 无关分支
            const operator = await resolveOperator(env, request);
            const cm = await canManageTarget(env, operator, userId);
            if (!cm.allowed) {
                return new Response(JSON.stringify({ code: -1, message: cm.reason }), { status: 403, headers: { 'content-type': 'application/json' } });
            }

            const countResult = await db.prepare('SELECT COUNT(*) as cnt FROM users').first();
            if (countResult && countResult.cnt <= 1) return new Response(JSON.stringify({ code: -1, message: '不能删除最后一个用户' }), { status: 400, headers: { 'content-type': 'application/json' } });

            // 其下级上提一级，避免出现无人能管的管理员
            await db.prepare('UPDATE users SET created_by = ? WHERE created_by = ?').bind(existing.created_by || '', userId).run();

            await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
            // 删除后实时踢下线：清掉该用户的全部会话凭证与登录数据
            await destroyUserSessionsById(env, userId);
            return new Response(JSON.stringify({ code: 0, message: '用户删除成功' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
