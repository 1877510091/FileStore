/**
 * 容量统计 API
 * GET  : 整盘与各渠道的容量分布（三段条数据源）
 * POST : 重新统计（触发索引重建）
 *
 * 统计口径：
 *   selfUsed   = 我（有组按组算）在该渠道的占用 + 分配给我但还没用满的额度
 *   othersUsed = 其他人在该渠道的占用 + 分配给别人但还没用满的额度
 *   total      = 该渠道配置的容量上限，0 表示不限额（例如 Telegram）
 */
import { rebuildIndex, readIndex } from '../../utils/indexManager.js';
import { fetchUploadConfig } from '../../utils/sysConfig.js';
import { getSessionUser } from '../../utils/auth/currentUser.js';
import { CHANNEL_TYPES, CONFIGURABLE_CHANNEL_TYPES, PASSTHROUGH_CHANNEL_TYPES, buildDisplayName } from '../../utils/channelRegistry.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    if (request.method === 'GET') {
        try {
            return json(await buildQuota(context));
        } catch (error) {
            return json({ code: -1, message: error.message }, 500);
        }
    }

    if (request.method === 'POST') {
        try {
            await rebuildIndex(context);
            return json(await buildQuota(context));
        } catch (error) {
            return json({ code: -1, message: error.message }, 500);
        }
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

export async function buildQuota(context) {
    const { env, request } = context;

    const uploadConfig = await fetchUploadConfig(env);

    // ---------- 1. 一次遍历索引，按 渠道 / 用户 / 组 三个维度聚合 ----------
    const indexResult = await readIndex(context, { count: -1, includeSubdirFiles: true, scope: { isAdmin: true } });
    const files = indexResult.files || [];

    const perOwner = new Map();
    const perChannel = new Map();
    let used = 0;

    for (const file of files) {
        const size = file.metadata.FileSizeBytes || 0;
        const owner = file.metadata.OwnerId || '';
        const group = file.metadata.GroupId || '';
        const channel = file.metadata.Channel || '';

        used += size;
        perOwner.set(owner, (perOwner.get(owner) || 0) + size);

        const ch = perChannel.get(channel) || { used: 0, fileCount: 0, byOwner: new Map(), byGroup: new Map() };
        ch.used += size;
        ch.fileCount += 1;
        ch.byOwner.set(owner, (ch.byOwner.get(owner) || 0) + size);
        if (group) ch.byGroup.set(group, (ch.byGroup.get(group) || 0) + size);
        perChannel.set(channel, ch);
    }

    // ---------- 2. 渠道定义与共享池总量（全部来自通道注册表，不写死任何渠道） ----------
    const channelDefs = [];
    let total = 0;
    for (const type of CONFIGURABLE_CHANNEL_TYPES) {
        const list = (uploadConfig[type.key]?.channels || []).filter(ch => ch.enabled !== false);
        for (const ch of list) {
            const limitGB = ch.quota && ch.quota.enabled ? (ch.quota.limitGB || 0) : 0;
            const limitBytes = limitGB * 1024 * 1024 * 1024;
            total += limitBytes;
            channelDefs.push({
                key: type.key,
                name: ch.name,
                type: type.channel,
                label: type.label,
                displayName: buildDisplayName(type, ch.name, list.length),
                shortLabel: type.shortLabel,
                color: type.color,
                icon: type.icon || '',
                connectable: type.connectable !== false,
                // 同一 key 下的具体实例名，上传/转通道时用它精确定位
                channelInstance: ch.name || '',
                quotaBytes: limitBytes,
                threshold: (ch.quota && ch.quota.threshold) || 95,
            });
        }
    }
    // 没有配置组的通道（外链）只在**真的有文件**时才出现 ——
    // 否则界面上会凭空多出一个"外链 · 无限容量"，纯噪音。
    for (const type of PASSTHROUGH_CHANNEL_TYPES) {
        const stat = perChannel.get(type.channel);
        if (!stat || !stat.fileCount) continue;
        channelDefs.push({
            key: type.key,
            name: type.defaultName,
            type: type.channel,
            label: type.label,
            displayName: type.label,
            shortLabel: type.shortLabel,
            color: type.color,
            icon: type.icon || '',
            connectable: false,
            channelInstance: '',
            quotaBytes: 0,
            threshold: 100,
        });
    }

    // ---------- 3. 当前用户口径 ----------
    const me = await getSessionUser(env, request);
    const myId = me ? me.id : '';
    const myGroup = me ? me.groupId : '';
    const isPrivileged = !me || me.role === 'admin';
    const selfOf = (byOwner, byGroup) => myGroup ? (byGroup.get(myGroup) || 0) : (byOwner.get(myId) || 0);

    // 当前用户的「每通道三态」：off（隐藏该通道）/ unlimited / custom（自定义配额）
    const myOffChannels = new Set();
    const myCustomQuota = new Map();
    const myUnlimitedChannels = new Set();
    if (myId) {
        const mine = await env.img_d1
            .prepare('SELECT channel, mode, quota_bytes FROM user_channel_quota WHERE user_id = ?')
            .bind(myId)
            .all();
        for (const r of (mine.results || [])) {
            if (r.mode === 'off') myOffChannels.add(r.channel);
            else if (r.mode === 'unlimited') myUnlimitedChannels.add(r.channel);
            else if (r.mode === 'custom') myCustomQuota.set(r.channel, r.quota_bytes || 0);
        }
    }

    // ---------- 4. 已单独分配但未用满的额度，按渠道归属到「自己 / 别人」 ----------
    const ucqRows = await env.img_d1.prepare('SELECT user_id, channel, mode, quota_bytes FROM user_channel_quota').all();
    const users = await env.img_d1.prepare('SELECT id, group_id FROM users').all();
    const groupOf = new Map((users.results || []).map(u => [u.id, u.group_id || '']));

    // 未指定渠道的配额归到「有配额的渠道」；都没有就归到第一个渠道
    const quotaChannels = channelDefs.filter(c => c.quotaBytes > 0);
    const fallbackKey = quotaChannels.length ? quotaChannels[0].key : (channelDefs[0] ? channelDefs[0].key : '');

    const reservedSelf = new Map();
    const reservedOthers = new Map();
    const addReserved = (map, key, bytes) => map.set(key, (map.get(key) || 0) + bytes);

    for (const row of ucqRows.results || []) {
        if (row.mode !== 'custom') continue; // 只有「自定义」配额才从共享池中占用
        const quota = row.quota_bytes || 0;
        if (quota <= 0) continue;
        const gap = Math.max(0, quota - (perOwner.get(row.user_id) || 0));
        if (gap === 0) continue;

        const channelKey = row.channel || fallbackKey;
        const sameScope = row.user_id === myId || (!!myGroup && groupOf.get(row.user_id) === myGroup);
        addReserved(sameScope ? reservedSelf : reservedOthers, channelKey, gap);
    }

    // ---------- 5. 逐渠道产出三段条数据 ----------
    const channels = [];
    let selfTotal = 0;
    let othersTotal = 0;
    // 只要**存在**至少一个不限额渠道（例如 Telegram），整个共享池就是不限容量的：
    // 用户可以一直往不限额渠道写，此时把池总量显示成「R2 的 10GB」是误导。
    let hasUnlimitedChannel = false;
    let limitedChannelCount = 0;
    let unlimitedChannelCount = 0;

    for (const def of channelDefs) {
        // 普通用户：被管理员设为「关闭通道」的渠道不返回（网盘页不显示、不可选）
        if (!isPrivileged && myOffChannels.has(def.key)) continue;

        const stat = perChannel.get(def.type) || { used: 0, fileCount: 0, byOwner: new Map(), byGroup: new Map() };
        const selfActual = selfOf(stat.byOwner, stat.byGroup);
        const selfReserved = reservedSelf.get(def.key) || 0;
        const othersReserved = reservedOthers.get(def.key) || 0;

        // 普通用户的渠道额度由「三态」决定：unlimited=不限、custom=该用户自己的配额
        let defQuotaBytes = def.quotaBytes;
        if (!isPrivileged) {
            if (myUnlimitedChannels.has(def.key)) defQuotaBytes = 0;
            else if (myCustomQuota.has(def.key)) defQuotaBytes = myCustomQuota.get(def.key);
        }

        const selfUsed = selfActual + selfReserved;
        const othersUsed = Math.max(0, stat.used - selfActual + othersReserved);
        const unlimited = defQuotaBytes === 0;
        const available = unlimited ? null : Math.max(0, defQuotaBytes - selfUsed - othersUsed);

        if (unlimited) { hasUnlimitedChannel = true; unlimitedChannelCount++; }
        else { limitedChannelCount++; }
        selfTotal += selfUsed;
        othersTotal += othersUsed;

        channels.push({
            // 唯一标识：同一 key 可能有多个实例（两个 R2 bucket / 两个 TG 机器人）
            id: def.channelInstance ? def.key + ':' + def.channelInstance : def.key,
            key: def.key,
            name: def.name,
            channel: def.key,
            channelInstance: def.channelInstance,
            type: def.type,
            displayName: def.displayName,
            label: def.label,
            shortLabel: def.shortLabel,
            color: def.color,
            icon: def.icon,
            connectable: def.connectable,
            fileCount: stat.fileCount,
            usedBytes: stat.used,
            unlimited,
            quota: {
                used: stat.used,
                total: defQuotaBytes,
                selfUsed,
                othersUsed,
                available,
                threshold: def.threshold,
            },
        });
    }

    // 共享池只要含一个不限额渠道就不限额（OR），不再是「所有渠道都不限额才算不限额」（AND）
    const overallUnlimited = hasUnlimitedChannel;

    return {
        code: 0,
        data: {
            used,
            // total = 所有**有限额**渠道的配额之和；不限额渠道不参与求和
            total,
            selfUsed: selfTotal,
            othersUsed: othersTotal,
            available: overallUnlimited ? null : Math.max(0, total - selfTotal - othersTotal),
            unlimited: overallUnlimited,
            // 前端据此渲染「无限容量（另有 10.0 GB 限额渠道）」
            limitedChannelCount,
            unlimitedChannelCount,
            hasUnlimitedChannel,
            totalCount: files.length,
            channels,
            lastUpdated: Date.now(),
        },
        // 兼容旧字段
        success: true,
        totalSizeMB: Math.round(used / 1024 / 1024 * 100) / 100,
        totalCount: files.length,
    };
}
