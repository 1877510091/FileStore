/**
 * 公开分享下载 API（无需登录）
 * GET /api/share/:token/download?code=xxxx
 * 服务端代取文件内容，不暴露 /file/ 直链；成功下载计入统计
 */
export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;
    const token = params.token;
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';

    const share = await db.prepare('SELECT * FROM file_shares WHERE token = ?').bind(token).first();
    if (!share) return new Response('分享不存在或已取消', { status: 404 });
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
        return new Response('分享链接已过期', { status: 410 });
    }
    if (share.code && code !== share.code) {
        return new Response('提取码错误', { status: 403 });
    }

    const target = new URL('/file/' + share.file_id.split('/').map(encodeURIComponent).join('/'), url.origin);
    const res = await fetch(target, { headers: request.headers });
    if (!res.ok) return new Response('文件读取失败', { status: 502 });

    const fileName = share.file_id.split('/').pop();
    const headers = new Headers();
    headers.set('content-type', res.headers.get('content-type') || 'application/octet-stream');
    const length = res.headers.get('content-length');
    if (length) headers.set('content-length', length);
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    headers.set('cache-control', 'private, no-store');

    context.waitUntil(
        db.prepare('UPDATE file_shares SET downloads = COALESCE(downloads, 0) + 1 WHERE token = ?').bind(token).run()
    );

    return new Response(res.body, { status: 200, headers });
}
