/**
 * 存储通道连通性测试
 *
 * POST /api/manage/channelTest
 *   body: { key: 'telegram' | 'cfr2' | 's3' | 'discord' | 'huggingface' | 'webdav', name: '<实例名>' }
 *   resp: { code: 0, data: { ok, ms, summary, steps: [{ name, ok, message }] } }
 *
 * 权限：/api/manage 走 manage/_middleware.js，这里需要 manage 权限
 *      （管理员会话，或带 manage 权限的 API Token）。
 *
 * 读的是**未过滤的原始配置**（不是 fetchUploadConfig），
 * 这样「已停用」的通道也能测 —— 停用中的通道恰恰最需要先测通再启用。
 */

import { getDatabase } from '../../utils/databaseAdapter.js';
import { getUploadConfig } from './sysConfig/upload.js';
import { testChannelConnectivity } from '../../utils/channelTest.js';
import { channelTypeOf } from '../../utils/channelRegistry.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
});

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
        return json({ code: -1, message: '仅支持 POST' }, 405);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ code: -1, message: '请求体不是合法 JSON' }, 400);
    }

    const key = String(body.key || '').toLowerCase();
    const name = body.name === undefined || body.name === null ? '' : String(body.name);

    const type = channelTypeOf(key);
    if (!type) return json({ code: -1, message: `未知的通道类型：${body.key}` }, 400);

    const db = getDatabase(env);
    let config;
    try {
        config = await getUploadConfig(db, env);
    } catch (err) {
        return json({ code: -1, message: `读取通道配置失败：${err.message}` }, 500);
    }

    const list = (config[key] && config[key].channels) || [];
    if (!list.length) {
        return json({ code: -1, message: `${type.label} 下还没有任何通道实例` }, 400);
    }

    // 优先按实例名精确匹配；没传或找不到时，单实例直接用它、多实例取第一个并回显实际测的是哪个
    let channel = name ? list.find(c => String(c.name) === name) : null;
    if (!channel) channel = list.length === 1 ? list[0] : list[0];
    if (!channel) return json({ code: -1, message: '找不到要测试的通道实例' }, 400);

    // 凭据类字段从来不回给前端，这里只在服务端内部使用
    const result = await testChannelConnectivity(key, channel, env);

    return json({
        code: 0,
        data: {
            key,
            name: channel.name || '',
            label: type.label,
            ...result,
        },
    });
}
