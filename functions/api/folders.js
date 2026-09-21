/**
 * 文件夹 API
 *
 * GET    /api/folders                 返回当前用户可见的完整文件夹树（扁平数组，带层级/文件数）
 * GET    /api/folders?parent=<path>   只返回某个目录下的直接子文件夹
 * POST   /api/folders                 新建文件夹  body: { parent, name }
 * DELETE /api/folders?path=<path>     删除空文件夹（非空则拒绝）
 *
 * 设计说明：
 * - 文件夹有两种来源，这里做合并去重：
 *   1) 文件索引里推导出来的（metadata.Directory）—— 有文件的文件夹；
 *   2) folders 表里显式登记的 —— 让空文件夹也能存在。
 * - 作用范围与文件可见性一致（管理员=全部，普通用户=自己 + 本组）。
 */
import { readIndex } from '../utils/indexManager.js';
import { getSessionUser } from '../utils/auth/currentUser.js';
import { logRequestActivity } from '../utils/activityLog.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
});

/** 目录路径归一化：统一正斜杠、去掉 ..、无头有尾（根目录为 ''） */
function normalizeDir(dir) {
    let d = String(dir || '').replace(/\\/g, '/');
    if (/%[0-9a-fA-F]{2}/.test(d)) {
        try { d = decodeURIComponent(d); } catch (e) { /* 非法编码就按原值处理 */ }
    }
    const segs = d.split('/')
        .map(s => s.replace(/\.\./g, '_').trim())
        .filter(s => s !== '' && s !== '.');
    return segs.length ? segs.join('/') + '/' : '';
}

/** 文件夹名归一化：去掉各系统的非法字符，限制长度 */
function normalizeFolderName(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/^\.+/, '_')
        .trim()
        .slice(0, 60);
}

/** 该文件夹对当前用户是否可见（与文件可见性规则保持一致） */
function makeVisibility(me) {
    if (me.role === 'admin') return () => true;
    return row => (row.owner_id && row.owner_id === me.id)
        || (!!me.groupId && !!row.group_id && row.group_id === me.groupId);
}

/** 从索引里把所有「有文件的文件夹路径」抽出来（含每一级祖先） */
function collectFoldersFromFiles(files, bucket) {
    for (const file of files || []) {
        const dir = file.metadata?.Directory || '';
        if (!dir) continue;
        const segs = dir.split('/').filter(Boolean);
        const size = file.metadata?.FileSizeBytes || 0;
        let acc = '';
        for (const seg of segs) {
            acc += seg + '/';
            const hit = bucket.get(acc) || { path: acc, name: seg, fileCount: 0, size: 0, registered: false };
            hit.fileCount += 1;
            hit.size += size;
            bucket.set(acc, hit);
        }
    }
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const db = env.img_d1;

    try {
        if (request.method === 'GET') {
            // 一次读全量索引（includeSubdirFiles），既拿到所有文件用于统计，
            // 也拿到所有有文件的文件夹路径。loadFiles 本来也是这个量级的读取。
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

            const bucket = new Map();
            collectFoldersFromFiles(result.files, bucket);

            const regRes = await db
                .prepare('SELECT id, name, path, parent_path, owner_id, group_id FROM folders')
                .all();
            const visible = makeVisibility(me);
            const registered = (regRes.results || []).filter(visible);

            for (const row of registered) {
                const hit = bucket.get(row.path)
                    || { path: row.path, name: row.name, fileCount: 0, size: 0, registered: false };
                hit.registered = true;
                hit.id = row.id;
                hit.name = row.name;
                bucket.set(row.path, hit);
            }

            // 计算每个文件夹是否有下级（索引里的更深路径，或登记的子文件夹）
            const paths = Array.from(bucket.keys());
            for (const f of bucket.values()) {
                f.hasChildren = paths.some(p => p !== f.path && p.startsWith(f.path))
                    || registered.some(r => r.parent_path === f.path);
            }

            const parentFilter = url.searchParams.has('parent')
                ? normalizeDir(url.searchParams.get('parent'))
                : null;
            const needParentCheck = url.searchParams.has('parent');

            const folders = Array.from(bucket.values())
                .filter(f => {
                    if (!needParentCheck) return true;
                    const p = f.path.replace(/\/$/, '');
                    const idx = p.lastIndexOf('/');
                    const parent = idx === -1 ? '' : p.slice(0, idx + 1);
                    return parent === parentFilter;
                })
                .map(f => {
                    const clean = f.path.replace(/\/$/, '');
                    const idx = clean.lastIndexOf('/');
                    return {
                        id: f.id || '',
                        name: f.name,
                        path: f.path,
                        parent: idx === -1 ? '' : clean.slice(0, idx + 1),
                        depth: f.path.split('/').filter(Boolean).length - 1,
                        fileCount: f.fileCount || 0,
                        size: f.size || 0,
                        hasChildren: !!f.hasChildren,
                        registered: !!f.registered,
                    };
                })
                .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));

            return json({
                code: 0,
                data: {
                    folders,
                    total: folders.length,
                    fileCount: result.directFileCount || 0,
                },
            });
        }

        if (request.method === 'POST') {
            let body;
            try {
                body = await request.json();
            } catch (e) {
                return json({ code: -1, message: '请求体格式错误' }, 400);
            }

            const parent = normalizeDir(body.parent);
            const name = normalizeFolderName(body.name);
            if (!name) return json({ code: -1, message: '文件夹名不能为空' }, 400);

            const path = parent + name + '/';

            // 目录深度限制，避免出现离谱的层级
            if (path.split('/').filter(Boolean).length > 12) {
                return json({ code: -1, message: '目录层级过深' }, 400);
            }

            // 已存在同名文件夹（索引里已有文件，或已登记过）
            const existsInIndex = await readIndex(context, {
                directory: parent,
                count: -1,
                scope: {
                    isAdmin: me.role === 'admin',
                    userId: me.id,
                    groupId: me.groupId,
                    grantorIds: [],
                },
            });
            if ((existsInIndex.directories || []).includes(path)) {
                return json({ code: -1, message: '该文件夹已存在' }, 409);
            }

            const visible = makeVisibility(me);
            const dupRes = await db
                .prepare('SELECT id, name, path, parent_path, owner_id, group_id FROM folders WHERE path = ?')
                .bind(path)
                .all();
            if ((dupRes.results || []).some(visible)) {
                return json({ code: -1, message: '该文件夹已存在' }, 409);
            }

            const id = 'fd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            await db
                .prepare('INSERT INTO folders (id, name, path, parent_path, owner_id, group_id) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(id, name, path, parent, me.id, me.groupId || '')
                .run();

            await logRequestActivity(env, request, 'folder', {
                fileId: path,
                fileName: name,
                details: '新建文件夹 ' + path,
            });

            return json({ code: 0, data: { id, name, path, parent } });
        }

        if (request.method === 'DELETE') {
            const path = normalizeDir(url.searchParams.get('path'));
            if (!path) return json({ code: -1, message: '缺少 path 参数' }, 400);

            const scope = {
                isAdmin: me.role === 'admin',
                userId: me.id,
                groupId: me.groupId,
                grantorIds: [],
            };

            // 递归删除文件夹内所有文件（含子文件夹）：逐个文件复用单文件删除接口，
            // 该接口已包含各存储渠道的物理删除、索引更新与 CDN 刷新。
            const queue = [path];
            let deletedFiles = 0;
            while (queue.length > 0) {
                const dir = queue.shift();
                const listUrl = new URL(`${url.origin}/api/manage/list?count=-1&dir=${encodeURIComponent(dir)}`);
                const listResp = await fetch(new Request(listUrl, { headers: request.headers }));
                const listData = await listResp.json();
                const files = (listData.data && listData.data.files) || [];
                for (const f of files) {
                    const fid = f.id || f.name;
                    if (!fid) continue;
                    const delUrl = new URL(`${url.origin}/api/manage/delete/${encodeURIComponent(fid)}`);
                    const delResp = await fetch(new Request(delUrl, { method: 'DELETE', headers: request.headers }));
                    if (delResp.ok) deletedFiles += 1;
                }
                const dirs = (listData.data && listData.data.directories) || [];
                for (const sub of dirs) queue.push(sub);
            }

            // 删除 folders 表里的文件夹记录（自身 + 所有后代），仅限当前用户可见范围。
            // LIKE 模式需转义 _ 和 %，避免文件夹名中的这两个字符被当成通配符。
            const likePat = path.replace(/[\\%_]/g, m => '\\' + m) + '%';
            const visible = makeVisibility(me);
            const rows = await db
                .prepare(`SELECT id, path, parent_path, owner_id, group_id FROM folders WHERE path = ? OR path LIKE ? ESCAPE '\\'`)
                .bind(path, likePat)
                .all();
            let removedFolders = 0;
            for (const t of (rows.results || []).filter(visible)) {
                await db.prepare('DELETE FROM folders WHERE id = ?').bind(t.id).run();
                removedFolders += 1;
            }

            await logRequestActivity(env, request, 'folder', {
                fileId: path,
                fileName: path.replace(/\/$/, '').split('/').pop() || path,
                details: '删除文件夹 ' + path + '（含 ' + deletedFiles + ' 个文件，' + removedFolders + ' 个文件夹记录）',
            });

            return json({ code: 0, data: { path, deletedFiles, removedFolders } });
        }

        return json({ code: -1, message: 'Method not allowed' }, 405);
    } catch (error) {
        return json({ code: -1, message: error.message }, 500);
    }
}
