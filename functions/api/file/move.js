/**
 * 把文件移动到指定文件夹
 *
 * POST /api/file/move   body: { ids: string[], target: string }
 *
 * 实现要点：只改索引里的 metadata.Directory，**不动存储层的 key**。
 * 这样对 R2 / Telegram / S3 / WebDAV / 分块上传等所有渠道都安全 ——
 * 文件物理位置不变、直链不变，只是逻辑归属换了个文件夹。
 * （本项目 files 索引本来就是按 metadata.Directory 过滤的，所以列表/目录树会立刻生效。）
 */
import { readIndex, moveFileInIndex } from '../../utils/indexManager.js';
import { getSessionUser } from '../../utils/auth/currentUser.js';
import { logRequestActivity } from '../../utils/activityLog.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
});

/** 目标目录归一化：统一正斜杠、去 ..、无头有尾（根目录为 ''） */
function normalizeDir(dir) {
    let d = String(dir || '').replace(/\\/g, '/');
    if (/%[0-9a-fA-F]{2}/.test(d)) {
        try { d = decodeURIComponent(d); } catch (e) { /* 按原值处理 */ }
    }
    const segs = d.split('/')
        .map(s => s.replace(/\.\./g, '_').trim())
        .filter(s => s !== '' && s !== '.');
    return segs.length ? segs.join('/') + '/' : '';
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
        return json({ code: -1, message: 'Method not allowed' }, 405);
    }

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return json({ code: -1, message: '请求体格式错误' }, 400);
    }

    const ids = Array.isArray(body.ids)
        ? body.ids.filter(x => typeof x === 'string' && x)
        : (typeof body.id === 'string' && body.id ? [body.id] : []);
    if (!ids.length) return json({ code: -1, message: '缺少要移动的文件' }, 400);

    const target = normalizeDir(body.target);

    // 只允许操作自己可见的文件：scope 之外的 id 查不到，天然被挡掉
    const result = await readIndex(context, {
        count: -1,
        includeSubdirFiles: true,
        scope: {
            isAdmin: me.role === 'admin',
            userId: me.id,
            groupId: me.groupId,
            grantorIds: [],
        },
    });

    const byId = new Map((result.files || []).map(f => [f.id, f]));
    const moved = [];
    const failed = [];

    for (const id of ids) {
        const entry = byId.get(id);
        if (!entry) {
            failed.push({ id, reason: '文件不存在或无权操作' });
            continue;
        }
        if ((entry.metadata?.Directory || '') === target) {
            failed.push({ id, reason: '已经在这个文件夹里了' });
            continue;
        }

        const metadata = { ...entry.metadata };
        metadata.Directory = target;

        // originalId === newId：只更新元数据，不产生任何存储层搬迁
        const r = await moveFileInIndex(context, id, id, metadata);
        if (r.success) moved.push(id);
        else failed.push({ id, reason: r.error || '移动失败' });
    }

    if (moved.length) {
        await logRequestActivity(env, request, 'move', {
            fileId: target,
            fileName: target || '根目录',
            details: '移动 ' + moved.length + ' 个文件到 ' + (target ? '/' + target : '根目录'),
        });
    }

    if (!moved.length) {
        return json({ code: -1, message: failed[0]?.reason || '移动失败', data: { moved, failed, target } }, 400);
    }

    return json({
        code: 0,
        message: failed.length ? '部分文件未能移动' : 'ok',
        data: { moved, failed, target },
    });
}
