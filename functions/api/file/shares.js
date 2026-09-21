/**
 * 文件分享 API（需登录）
 * POST   : 创建分享链接（可带提取码与有效期）；shareType=friend 时退化为好友直发
 * GET    : 查询分享记录，?fileId= 只看某个文件的
 */
import { getSessionUser } from '../../utils/auth/currentUser.js';
import { logActivity } from '../../utils/activityLog.js';

const ALLOWED_EXPIRES = [1, 24, 72, 168, 720];

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const url = new URL(request.url);

    if (request.method === 'GET') {
        const fileId = url.searchParams.get('fileId');

        let rows;
        if (fileId) {
            rows = await db
                .prepare('SELECT * FROM file_shares WHERE file_id = ? AND shared_by = ? ORDER BY created_at DESC')
                .bind(fileId, me.id)
                .all();
        } else {
            rows = await db
                .prepare('SELECT * FROM file_shares WHERE shared_by = ? ORDER BY created_at DESC LIMIT 200')
                .bind(me.id)
                .all();
        }

        return json({ code: 0, data: { shares: (rows.results || []).map(toClient(url.origin)) } });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const { fileId, shareType, sharedWith, hasCode, code, expiresHours } = body;
        if (!fileId) return json({ code: -1, message: '缺少文件ID' }, 400);

        // 好友直发：不带 token，仅记录授权关系（聊天发文件用）
        if (shareType === 'friend') {
            if (!sharedWith) return json({ code: -1, message: '缺少好友ID' }, 400);
            const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            await db
                .prepare('INSERT INTO file_shares (id, file_id, shared_by, shared_with, share_type, permissions) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(id, fileId, me.id, sharedWith, 'friend', 'read')
                .run();
            return json({ code: 0, message: '已分享给好友', data: { id } });
        }

        // 链接分享：生成 token，可选提取码与有效期
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        let shareCode = null;
        if (hasCode) {
            shareCode = String(code || '').trim().slice(0, 16) || String(Math.floor(1000 + Math.random() * 9000));
            if (!/^[A-Za-z0-9]+$/.test(shareCode)) return json({ code: -1, message: '提取码只能用字母或数字' }, 400);
        }

        const hours = Number(expiresHours);
        const expiresAt = ALLOWED_EXPIRES.includes(hours) ? new Date(Date.now() + hours * 3600000).toISOString() : null;

        const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await db
            .prepare('INSERT INTO file_shares (id, file_id, shared_by, shared_with, share_type, permissions, expires_at, token, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, fileId, me.id, '', 'link', shareCode ? 'code' : 'open', expiresAt, token, shareCode)
            .run();

        await logActivity(env, {
            userId: me.id,
            action: 'share',
            fileId,
            fileName: fileId.split('/').pop(),
            details: (shareCode ? '创建带提取码的分享链接' : '创建分享链接') + (expiresAt ? `，有效期至 ${expiresAt.slice(0, 16).replace('T', ' ')}` : '，永久有效'),
        });

        return json({
            code: 0,
            data: {
                id,
                token,
                code: shareCode,
                url: `${url.origin}/s/${token}`,
                urlWithCode: shareCode ? `${url.origin}/s/${token}=${shareCode}` : `${url.origin}/s/${token}`,
                expiresAt,
            }
        });
    }

    if (request.method === 'DELETE') {
        const token = url.searchParams.get('token');
        const id = url.searchParams.get('id');
        if (token) {
            await db.prepare('DELETE FROM file_shares WHERE token = ? AND shared_by = ?').bind(token, me.id).run();
        } else if (id) {
            await db.prepare('DELETE FROM file_shares WHERE id = ? AND shared_by = ?').bind(id, me.id).run();
        } else {
            return json({ code: -1, message: '缺少分享标识' }, 400);
        }
        return json({ code: 0, message: '分享已取消' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function toClient(origin) {
    return s => ({
        id: s.id,
        token: s.token || '',
        code: s.code || '',
        fileId: s.file_id,
        shareType: s.share_type,
        sharedWith: s.shared_with || '',
        expiresAt: s.expires_at || null,
        createdAt: s.created_at,
        views: s.views || 0,
        downloads: s.downloads || 0,
        expired: !!(s.expires_at && new Date(s.expires_at).getTime() < Date.now()),
        url: s.token ? `${origin}/s/${s.token}${s.code ? '=' + s.code : ''}` : '',
    });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
