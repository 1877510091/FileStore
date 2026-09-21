/**
 * 上传渠道列表 API
 * 返回渠道名称、类型与容量占用，供前端顶部通道选择器与侧边栏存储条使用
 */
import { buildQuota } from './manage/quota.js';
import { dualAuthCheck } from '../utils/auth/dualAuth.js';

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const { authorized } = await dualAuthCheck(env, url, request);
    if (!authorized) {
        return new Response(JSON.stringify({ code: -1, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const quota = await buildQuota(context);
        const channels = quota.data.channels;
        // 附加上传限制大小（MB），供前端上传前校验
        let maxSizeMB = 0;
        try {
            const db = (await import('../utils/databaseAdapter.js')).getDatabase(env);
            const cfg = await db.get('manage@sysConfig@upload');
            if (cfg) { const parsed = JSON.parse(cfg); maxSizeMB = parsed.maxSize || 0; }
        } catch(e) {}
        return new Response(JSON.stringify({ code: 0, data: channels, maxSize: maxSizeMB }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ code: -1, message: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
