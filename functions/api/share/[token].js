/**
 * 公开分享信息 API（无需登录）
 * GET /api/share/:token?code=xxxx
 * 有提取码且未通过校验时，不返回任何文件信息
 */
import { getDatabase } from '../../utils/databaseAdapter.js';

export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const token = params.token;
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';

    const share = await db.prepare('SELECT * FROM file_shares WHERE token = ?').bind(token).first();
    if (!share) return json({ ok: false, error: '分享不存在或已取消' }, 404);

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
        return json({ ok: false, error: '分享链接已过期' }, 410);
    }

    if (share.code && code !== share.code) {
        return json({ ok: true, hasCode: true, verified: false });
    }

    const adapter = getDatabase(env);
    const record = await adapter.getWithMetadata(share.file_id);
    if (!record) return json({ ok: false, error: '文件已被删除' }, 404);

    const meta = record.metadata || {};
    const views = (share.views || 0) + 1;
    await db.prepare('UPDATE file_shares SET views = COALESCE(views, 0) + 1 WHERE token = ?').bind(token).run();

    return json({
        ok: true,
        hasCode: !!share.code,
        verified: true,
        name: meta.FileName || share.file_id.split('/').pop(),
        size: meta.FileSizeBytes || 0,
        type: meta.FileType || '',
        owner: meta.OwnerName || '',
        uploadTime: meta.TimeStamp || 0,
        createdAt: share.created_at,
        expiresAt: share.expires_at || null,
        downloads: share.downloads || 0,
        views,
    });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
}
