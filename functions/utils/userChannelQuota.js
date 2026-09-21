/**
 * 用户 · 通道级配额（user_channel_quota）
 *
 * mode: 'off'（关闭通道）/ 'unlimited'（不限制）/ 'custom'（自定义，quota_bytes 生效）
 * 某用户在表中没有任何行 = 「全部通道共享」模式（默认）。
 */

const MODES = ['off', 'unlimited', 'custom'];

export function normalizeMode(m) {
    return MODES.includes(m) ? m : 'off';
}

/** 读取单个用户的通道配额配置 */
export async function getUserChannelQuotas(env, userId) {
    const r = await env.img_d1
        .prepare('SELECT channel, mode, quota_bytes FROM user_channel_quota WHERE user_id = ?')
        .bind(userId)
        .all();
    return (r.results || []).map(x => ({
        channel: x.channel,
        mode: normalizeMode(x.mode),
        quotaBytes: x.quota_bytes || 0,
    }));
}

/** 批量读取所有用户的通道配额 → Map<userId, rows[]> */
export async function getAllUserChannelQuotas(env) {
    const r = await env.img_d1
        .prepare('SELECT user_id, channel, mode, quota_bytes FROM user_channel_quota')
        .all();
    const map = new Map();
    for (const x of (r.results || [])) {
        if (!map.has(x.user_id)) map.set(x.user_id, []);
        map.get(x.user_id).push({
            channel: x.channel,
            mode: normalizeMode(x.mode),
            quotaBytes: x.quota_bytes || 0,
        });
    }
    return map;
}

/**
 * 覆盖写入某用户的通道配额。
 * quotas 为空数组 → 清空（回到「全部通道共享」）。
 */
export async function setUserChannelQuotas(env, userId, quotas) {
    const db = env.img_d1;
    await db.prepare('DELETE FROM user_channel_quota WHERE user_id = ?').bind(userId).run();
    const arr = Array.isArray(quotas) ? quotas : [];
    for (const q of arr) {
        if (!q || !q.channel) continue;
        const mode = normalizeMode(q.mode);
        const bytes = mode === 'custom' ? Math.max(0, Math.round(Number(q.quotaBytes) || 0)) : 0;
        await db
            .prepare('INSERT OR REPLACE INTO user_channel_quota (user_id, channel, mode, quota_bytes, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
            .bind(userId, q.channel, mode, bytes)
            .run();
    }
}

/** 由配置行推导「存储模式」：有行=custom，无行=shared */
export function storageModeOf(rows) {
    return (Array.isArray(rows) && rows.length > 0) ? 'custom' : 'shared';
}
