/**
 * 通道类型注册表 API
 *
 * GET /api/channelTypes → { code:0, data:[{key,channel,label,shortLabel,color,
 *                           configurable,connectable,chunkedUnsupported,maxFileBytes,fields:[…]}] }
 *
 * 前端（网盘页 + 管理后台）据此渲染：通道徽标、上传通道选择器、转通道目标列表、
 * 以及「存储通道」页的增删改表单。**新增一种存储通道只需改 channelRegistry.js**，
 * 前端不用动。
 */
import { CHANNEL_TYPES } from '../utils/channelRegistry.js';
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

    return new Response(JSON.stringify({ code: 0, data: CHANNEL_TYPES }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' }
    });
}
