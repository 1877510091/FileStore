/**
 * 用户存储分配 API
 * GET : 返回各用户的配额、通道与实际占用（含共享池汇总）
 * POST: 设置某用户的独立配额与存储通道
 */
import { readIndex } from '../../utils/indexManager.js';
import { buildQuota } from '../manage/quota.js';
import { getAllUserChannelQuotas, setUserChannelQuotas, storageModeOf } from '../../utils/userChannelQuota.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    if (request.method === 'GET') {
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId');
        const quota = await buildQuota(context);

        const perOwner = await ownerUsage(context);
        const quotaMap = await getAllUserChannelQuotas(env);

        if (userId) {
            const cq = quotaMap.get(userId) || [];
            return json({
                code: 0,
                data: {
                    userId,
                    storageMode: storageModeOf(cq),
                    channelQuotas: cq,
                    usedBytes: perOwner.get(userId) || 0,
                }
            });
        }

        const users = await db.prepare('SELECT id, username, display_name, group_id FROM users ORDER BY created_at DESC').all();
        const list = (users.results || []).map(u => {
            const cq = quotaMap.get(u.id) || [];
            return {
                userId: u.id,
                username: u.username,
                displayName: u.display_name || u.username,
                groupId: u.group_id || '',
                storageMode: storageModeOf(cq),
                channelQuotas: cq,
                usedBytes: perOwner.get(u.id) || 0,
            };
        });

        const allocated = list.reduce((sum, u) => sum + (u.channelQuotas || []).reduce((s, q) => s + (q.mode === 'custom' ? (q.quotaBytes || 0) : 0), 0), 0);

        return json({
            code: 0,
            data: {
                list,
                pool: {
                    total: quota.data.total,
                    used: quota.data.used,
                    allocated,
                    unallocated: Math.max(0, quota.data.total - allocated),
                    // 含不限额渠道（如 Telegram）时，整个共享池不限容量
                    unlimited: !!quota.data.unlimited,
                    unlimitedChannelCount: quota.data.unlimitedChannelCount || 0,
                    limitedChannelCount: quota.data.limitedChannelCount || 0,
                },
                channels: quota.data.channels,
            }
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const { userId, storageMode, channelQuotas } = body;
        if (!userId) return json({ code: -1, message: '缺少用户ID' }, 400);

        // 自定义模式写入每通道三态配置；共享模式清空（回到「全部通道共享」）
        if (storageMode === 'custom') {
            await setUserChannelQuotas(env, userId, Array.isArray(channelQuotas) ? channelQuotas : []);
        } else {
            await setUserChannelQuotas(env, userId, []);
        }

        return json({ code: 0, message: '存储配置保存成功' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

// 按文件归属统计每个用户的实际占用
async function ownerUsage(context) {
    const indexResult = await readIndex(context, { count: -1, includeSubdirFiles: true, scope: { isAdmin: true } });
    const perOwner = new Map();
    for (const file of indexResult.files || []) {
        const owner = file.metadata.OwnerId || '';
        perOwner.set(owner, (perOwner.get(owner) || 0) + (file.metadata.FileSizeBytes || 0));
    }
    return perOwner;
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
