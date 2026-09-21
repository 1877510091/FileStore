import {
    readIndex, mergeOperationsToIndex, deleteAllOperations, rebuildIndex,
    getIndexInfo, getIndexStorageStats
} from '../../utils/indexManager.js';
import { getDatabase } from '../../utils/databaseAdapter.js';
import { createMetadataViewContext, serializeFileRecordForManagement } from '../../utils/metadata/metadataView.js';
import { resolveFileScope } from '../../utils/auth/currentUser.js';

// CORS 跨域响应头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
});

export async function onRequest(context) {
    const { request, waitUntil } = context;
    const url = new URL(request.url);

    // 解析查询参数
    let start = parseInt(url.searchParams.get('start'), 10) || 0;
    let count = parseInt(url.searchParams.get('count'), 10) || 50;
    let sum = url.searchParams.get('sum') === 'true';
    let recursive = url.searchParams.get('recursive') === 'true';
    let dir = url.searchParams.get('dir') || '';
    let search = url.searchParams.get('search') || '';
    let channel = url.searchParams.get('channel') || '';
    let listType = url.searchParams.get('listType') || '';
    let accessStatus = url.searchParams.get('accessStatus') || '';
    let action = url.searchParams.get('action') || '';
    let includeTags = url.searchParams.get('includeTags') || '';
    let excludeTags = url.searchParams.get('excludeTags') || '';
    let label = url.searchParams.get('label') || '';
    let fileType = url.searchParams.get('fileType') || url.searchParams.get('type') || '';
    let channelName = url.searchParams.get('channelName') || '';
    let sort = url.searchParams.get('sort') || 'date';
    let order = url.searchParams.get('order') || 'desc';
    let groupId = url.searchParams.get('groupId') || '';

    if (search) {
        search = decodeURIComponent(search).trim();
    }

    const includeTagsArray = includeTags ? includeTags.split(',').map(t => t.trim()).filter(t => t) : [];
    const excludeTagsArray = excludeTags ? excludeTags.split(',').map(t => t.trim()).filter(t => t) : [];
    const listTypeArray = listType ? listType.split(',').map(t => t.trim()).filter(t => t) : [];
    const accessStatusArray = accessStatus ? accessStatus.split(',').map(t => t.trim()).filter(t => t) : [];
    const labelArray = label ? label.split(',').map(t => t.trim()).filter(t => t) : [];
    const fileTypeArray = fileType ? fileType.split(',').map(t => t.trim()).filter(t => t) : [];
    const channelArray = channel ? channel.split(',').map(t => t.trim()).filter(t => t) : [];
    const channelNameArray = channelName ? channelName.split(',').map(t => t.trim()).filter(t => t) : [];

    if (dir) {
        dir = dir.replace(/\.\./g, '_').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    }
    if (dir.startsWith('/')) {
        dir = dir.substring(1);
    }
    if (dir && !dir.endsWith('/')) {
        dir += '/';
    }

    try {
        // 特殊操作：重建索引
        if (action === 'rebuild') {
            waitUntil(rebuildIndex(context, (processed) => {
                console.log(`Rebuilt ${processed} files...`);
            }));
            return new Response('Index rebuilt asynchronously', {
                headers: { "Content-Type": "text/plain", ...corsHeaders }
            });
        }

        if (action === 'merge-operations') {
            waitUntil(mergeOperationsToIndex(context));
            return new Response('Operations merged into index asynchronously', {
                headers: { "Content-Type": "text/plain", ...corsHeaders }
            });
        }

        if (action === 'delete-operations') {
            waitUntil(deleteAllOperations(context));
            return new Response('All operations deleted asynchronously', {
                headers: { "Content-Type": "text/plain", ...corsHeaders }
            });
        }

        if (action === 'index-storage-stats') {
            return json(await getIndexStorageStats(context));
        }

        if (action === 'info') {
            return json(await getIndexInfo(context, {
                timezoneOffset: url.searchParams.get('timezoneOffset'),
                maxPoints: url.searchParams.get('trendMaxPoints'),
                seriesLimit: url.searchParams.get('trendSeriesLimit'),
                startDate: url.searchParams.get('trendStartDate'),
                endDate: url.searchParams.get('trendEndDate')
            }));
        }

        // 当前用户可见范围（管理员=全部，普通用户=自己+所有加入的组+被授权的盘）
        const scope = await resolveFileScope(context.env, request);

        // 如果指定了 groupId，覆盖 scope 为只看该组的文件
        if (groupId) {
            scope.groupIds = [groupId];
            scope.groupId = groupId;
        }

        // 只返回总数
        if (count === -1 && sum) {
            const result = await readIndex(context, {
                search,
                directory: dir,
                channel: channelArray,
                listType: listTypeArray,
                accessStatus: accessStatusArray,
                label: labelArray,
                fileType: fileTypeArray,
                channelName: channelNameArray,
                includeTags: includeTagsArray,
                excludeTags: excludeTagsArray,
                scope,
                countOnly: true
            });

            return json({
                code: 0,
                data: { total: result.totalCount, indexLastUpdated: result.indexLastUpdated },
                sum: result.totalCount,
                indexLastUpdated: result.indexLastUpdated
            });
        }

        // 普通查询
        const result = await readIndex(context, {
            search,
            directory: dir,
            count: -1,
            channel: channelArray,
            listType: listTypeArray,
            accessStatus: accessStatusArray,
            label: labelArray,
            fileType: fileTypeArray,
            channelName: channelNameArray,
            includeTags: includeTagsArray,
            excludeTags: excludeTagsArray,
            scope,
            includeSubdirFiles: recursive,
        });

        const db = getDatabase(context.env);
        const metadataViewContext = await createMetadataViewContext(db, context.env);

        // 索引不可用时回退到 KV 全量列举
        if (!result.success) {
            const fallback = await getAllFileRecords(context.env, dir, scope);
            return json({
                code: 0,
                data: {
                    files: sortFiles(fallback.files, sort, order),
                    directories: fallback.directories,
                    totalCount: fallback.totalCount,
                    directFileCount: fallback.directFileCount,
                    directFolderCount: fallback.directFolderCount,
                    returnedCount: fallback.returnedCount,
                    indexLastUpdated: Date.now(),
                    isIndexedResponse: false
                }
            });
        }

        const clientFiles = await Promise.all(
            result.files.map(file => toClientFile(db, context.env, file, metadataViewContext))
        );
        const sorted = sortFiles(clientFiles, sort, order);
        const paged = count === -1 ? sorted : sorted.slice(Math.max(0, start), Math.max(0, start) + Math.max(1, count));

        return json({
            code: 0,
            data: {
                files: paged,
                directories: result.directories,
                totalCount: result.totalCount,
                directFileCount: result.directFileCount,
                directFolderCount: result.directFolderCount,
                returnedCount: paged.length,
                indexLastUpdated: result.indexLastUpdated,
                isIndexedResponse: true
            }
        });

    } catch (error) {
        return json({ code: -1, message: error.message }, 500);
    }
}

// 把索引记录转成前端直接可用的扁平结构
async function toClientFile(db, env, file, metadataViewContext) {
    const record = await serializeFileRecordForManagement(db, env, file, metadataViewContext);
    const m = record.metadata || {};
    return {
        id: record.name,
        fileName: m.FileName || record.name,
        fileType: m.FileType || '',
        fileSize: m.FileSizeBytes || 0,
        uploadTime: m.TimeStamp || 0,
        channel: m.Channel || '',
        channelName: m.ChannelName || '',
        directory: m.Directory || '',
        tags: m.Tags || [],
        label: m.Label || 'None',
        listType: m.ListType || 'None',
        width: m.Width || 0,
        height: m.Height || 0,
        ownerId: m.OwnerId || '',
        ownerName: m.OwnerName || '',
        groupId: m.GroupId || '',
        src: m.S3CdnFileUrl || m.HfFileUrl || m.WebDAVPublicUrl || '',
    };
}

// 排序：date=上传时间，name=文件名，size=大小
function sortFiles(files, sort, order) {
    const asc = order === 'asc';
    const pick = f => sort === 'name'
        ? String(f.fileName || f.id || '').toLowerCase()
        : sort === 'size' ? (f.fileSize || 0) : (f.uploadTime || 0);

    return [...files].sort((a, b) => {
        const va = pick(a);
        const vb = pick(b);
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });
}

async function getAllFileRecords(env, dir, scope) {
    const allRecords = [];
    let cursor = null;

    const db = getDatabase(env);
    const metadataViewContext = await createMetadataViewContext(db, env);

    while (true) {
        const response = await db.list({
            prefix: dir,
            limit: 1000,
            cursor: cursor
        });

        if (!response || !response.keys || !Array.isArray(response.keys)) {
            break;
        }

        cursor = response.cursor;

        for (const item of response.keys) {
            if (item.name.startsWith('manage@') || item.name.startsWith('chunk_')) {
                continue;
            }
            if (!item.metadata || !item.metadata.TimeStamp) {
                continue;
            }
            if (scope && !scope.isAdmin) {
                const owner = item.metadata.OwnerId || '';
                const fileGroup = item.metadata.GroupId || '';
                const visible = (owner && owner === scope.userId)
                    || (scope.groupId && fileGroup && fileGroup === scope.groupId)
                    || (owner && (scope.grantorIds || []).includes(owner));
                if (!visible) continue;
            }
            allRecords.push(await toClientFile(db, env, item, metadataViewContext));
        }

        if (!cursor) break;
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    const directories = new Set();
    const filteredRecords = [];
    allRecords.forEach(item => {
        const subDir = item.id.substring(dir.length);
        const firstSlashIndex = subDir.indexOf('/');
        if (firstSlashIndex !== -1) {
            directories.add(dir + subDir.substring(0, firstSlashIndex));
        } else {
            filteredRecords.push(item);
        }
    });

    return {
        files: filteredRecords,
        directories: Array.from(directories),
        totalCount: allRecords.length,
        directFileCount: filteredRecords.length,
        directFolderCount: directories.size,
        returnedCount: filteredRecords.length
    };
}
