/**
 * 文件转通道 —— 把已经上传好的文件搬到另一个存储渠道，用户不需要重新上传。
 *
 * POST /api/file/transfer
 *   body: { ids: string[], targetChannel: 'cfr2'|'telegram'|'s3'|'discord'|'huggingface'|'webdav', targetChannelName?: string }
 *   返回: { code:0, data:{ moved:[], failed:[{id,reason}], target, targetLabel } }
 *
 * 实现要点（与 /api/file/move 的「只改元数据」不同，这里是真的搬字节）：
 *   1. 用调用者的会话去服务端拉 `/file/:id`（不经过用户浏览器），拿到源文件流；
 *   2. 以**同一个 fileId** 写进目标渠道 —— 直链、分享 token、索引 id 全部不变；
 *   3. 先写成功，再更新 files 表 + 索引里的 metadata（Channel / ChannelName / 各渠道专有字段）；
 *   4. 最后才清理源渠道的物理副本（TG 除外：本项目从来没有删 TG 消息的能力，与「删除文件」行为一致）。
 *
 * 大小限制：R2 走流式直写，没有缓冲上限；其余渠道需要整体缓冲（FormData / SDK 限制），
 * 受 Worker 128MB 内存约束，故设 BUFFER_LIMIT。超限时返回明确提示而不是把 Worker 打挂。
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { readIndex, moveFileInIndex } from '../../utils/indexManager.js';
import { getSessionUser } from '../../utils/auth/currentUser.js';
import { logRequestActivity } from '../../utils/activityLog.js';
import { getDatabase } from '../../utils/databaseAdapter.js';
import { fetchUploadConfig } from '../../utils/sysConfig.js';
import { purgeCFCache, purgeRandomFileListCache, purgePublicFileListCache } from '../../utils/purgeCache.js';
import { TelegramAPI } from '../../utils/storage/telegramAPI.js';
import { DiscordAPI } from '../../utils/storage/discordAPI.js';
import { HuggingFaceAPI } from '../../utils/storage/huggingfaceAPI.js';
import { WebDAVAPI } from '../../utils/storage/webdavAPI.js';
import {
    resolveS3Credentials,
    resolveDiscordCredentials,
    resolveHuggingFaceCredentials,
    resolveWebDAVCredentials,
} from '../../utils/metadata/channelCredentials.js';
import { CHANNEL_TYPES, channelTypeOf, channelKeyOf } from '../../utils/channelRegistry.js';

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

/** 需要整体缓冲进内存的渠道上限（Worker 内存 128MB，留足余量） */
const BUFFER_LIMIT = 80 * 1024 * 1024;
/** TG 单条文档可被 getFile 下载的上限，超过就走分片 */
const TG_CHUNK_SIZE = 16 * 1024 * 1024;

/** 源渠道专有字段：换渠道时要清掉，避免残留指向旧渠道 */
const CHANNEL_FIELDS = ['TgFileId', 'IsChunked', 'TotalChunks', 'DiscordMessageId', 'HfFilePath', 'WebDAVFilePath', 'S3FileKey', 'ExternalLink'];

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
    if (!ids.length) return json({ code: -1, message: '缺少要转移的文件' }, 400);

    const targetKey = String(body.targetChannel || '').toLowerCase();
    const target = channelTypeOf(targetKey);
    if (!target) {
        const usable = CHANNEL_TYPES.filter(t => t.connectable).map(t => t.key).join(' / ');
        return json({ code: -1, message: `未知的通道类型「${body.targetChannel}」，可用：${usable}` }, 400);
    }
    if (!target.connectable) {
        return json({ code: -1, message: `${target.label} 渠道不保存文件本体（只记外链），不能作为转移目标` }, 400);
    }

    const uploadConfig = await fetchUploadConfig(env, context);
    const targetChannel = pickTargetChannel(uploadConfig, targetKey, body.targetChannelName);
    if (!targetChannel) {
        return json({ code: -1, message: target.label + ' 通道未启用或未配置' }, 400);
    }

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

    const db = getDatabase(env);
    const moved = [];
    const failed = [];

    for (const id of ids) {
        const entry = byId.get(id);
        if (!entry) {
            failed.push({ id, reason: '文件不存在或无权操作' });
            continue;
        }

        const md = { ...(entry.metadata || {}) };

        // 归属校验：本人 / 同组 / 管理员
        const isOwner = (md.OwnerId || '') === me.id;
        const isSameGroup = !!me.groupId && (md.GroupId || '') === me.groupId;
        if (!isOwner && !isSameGroup && me.role !== 'admin') {
            failed.push({ id, reason: '只能转移自己的文件' });
            continue;
        }

        if ((md.Channel || '') === target.channel) {
            failed.push({ id, reason: '文件已经在这个通道了' });
            continue;
        }

        try {
            const written = await writeToChannel(context, id, md, targetKey, target, targetChannel, request);
            // 先写成功，再落库 + 更新索引（same id：不产生重复条目）
            await db.put(id, written.value, { metadata: written.metadata });
            await moveFileInIndex(context, id, id, written.metadata);
            // 最后清理源渠道
            await cleanupSourceChannel(env, id, md, request);
            moved.push({ id, from: md.Channel || '', to: target.channel, fromChannel: channelKeyOf(md.Channel), toChannel: targetKey });
        } catch (e) {
            console.error('transfer failed for', id, e && e.message);
            failed.push({ id, reason: (e && e.message) || '转移失败' });
        }
    }

    if (moved.length) {
        await logRequestActivity(env, request, 'transfer', {
            fileId: moved[0].id,
            fileName: moved.length === 1 ? (byId.get(moved[0].id)?.metadata?.FileName || moved[0].id) : `${moved.length} 个文件`,
            details: `转移到 ${target.label}${moved.length > 1 ? `（共 ${moved.length} 个）` : ''}`,
        });
    }

    if (!moved.length) {
        return json({ code: -1, message: failed[0]?.reason || '转移失败', data: { moved, failed } }, 400);
    }

    return json({
        code: 0,
        message: failed.length ? '部分文件未能转移' : '成功转移到 ' + target.label,
        data: { moved, failed, target: targetKey, targetLabel: target.label },
    });
}

/** 选中目标渠道配置：优先按名字匹配，否则取第一个启用的 */
function pickTargetChannel(uploadConfig, key, name) {
    const list = (uploadConfig && uploadConfig[key] && uploadConfig[key].channels) || [];
    if (!list.length) return null;
    if (name) {
        const hit = list.find(ch => ch.name === name);
        if (hit) return hit;
    }
    return list[0];
}

/** 服务端代取源文件（带上调用者请求头 → 会话鉴权与分享链接一致） */
async function fetchSource(request, id) {
    const origin = new URL(request.url).origin;
    const target = new URL('/file/' + id.split('/').map(encodeURIComponent).join('/'), origin);
    const res = await fetch(target, { headers: request.headers });
    if (!res.ok) {
        throw new Error('读取源文件失败（HTTP ' + res.status + '）');
    }
    return res;
}

function sizeOf(md, res) {
    const h = res.headers.get('content-length');
    if (h && Number(h) > 0) return Number(h);
    return Number(md.FileSizeBytes || 0);
}

async function buffered(res, limit, label) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > limit) {
        throw new Error(`${label} 需要整体缓冲，单文件上限 ${Math.round(limit / 1024 / 1024)}MB，该文件过大`);
    }
    return buf;
}

/** 写进目标渠道，返回 { metadata, value } */
async function writeToChannel(context, id, md, targetKey, target, ch, request) {
    const { env } = context;

    switch (targetKey) {
        case 'cfr2': return writeR2(env, id, md, target, ch, request);
        case 's3': return writeS3(id, md, target, ch, request);
        case 'webdav': return writeWebDAV(id, md, target, ch, request);
        case 'discord': return writeDiscord(id, md, target, ch, request);
        case 'huggingface': return writeHuggingFace(id, md, target, ch, request);
        case 'telegram': return writeTelegram(id, md, target, ch, request);
        default: throw new Error('不支持的通道');
    }
}

/** 统一收敛 metadata：清掉旧渠道专有字段，写入新渠道标识 */
function baseMetadata(md, target, channelName) {
    const metadata = { ...md, Channel: target.channel, ChannelName: channelName || '' };
    for (const f of CHANNEL_FIELDS) delete metadata[f];
    return metadata;
}

async function writeR2(env, id, md, target, ch, request) {
    if (!env.img_r2) throw new Error('未配置 R2 存储绑定（img_r2）');
    const res = await fetchSource(request, id);
    const metadata = baseMetadata(md, target, ch.name || 'R2_env');
    try {
        // R2 绑定支持流式写入，大文件不占内存
        await env.img_r2.put(id, res.body, {
            httpMetadata: { contentType: md.FileType || 'application/octet-stream' },
        });
    } catch (e) {
        // 流式失败时退回缓冲写（小文件场景）
        const res2 = await fetchSource(request, id);
        const buf = await buffered(res2, BUFFER_LIMIT, 'R2 退回缓冲写入');
        await env.img_r2.put(id, buf, {
            httpMetadata: { contentType: md.FileType || 'application/octet-stream' },
        });
    }
    return { metadata, value: '' };
}

async function writeS3(id, md, target, ch, request) {
    const res = await fetchSource(request, id);
    const buf = await buffered(res, BUFFER_LIMIT, 'S3');
    const client = new S3Client({
        region: ch.region || 'auto',
        endpoint: ch.endpoint,
        credentials: { accessKeyId: ch.accessKeyId, secretAccessKey: ch.secretAccessKey },
        forcePathStyle: !!ch.pathStyle,
    });
    await client.send(new PutObjectCommand({
        Bucket: ch.bucketName,
        Key: id,
        Body: new Uint8Array(buf),
        ContentType: md.FileType || 'application/octet-stream',
    }));
    const metadata = baseMetadata(md, target, ch.name);
    metadata.S3FileKey = id;
    return { metadata, value: '' };
}

async function writeWebDAV(id, md, target, ch, request) {
    const res = await fetchSource(request, id);
    const buf = await buffered(res, BUFFER_LIMIT, 'WebDAV');
    const api = new WebDAVAPI(ch);
    await api.putFile(id, new Blob([buf], { type: md.FileType || 'application/octet-stream' }), md.FileType || 'application/octet-stream');
    const metadata = baseMetadata(md, target, ch.name || 'WebDAV_env');
    metadata.WebDAVFilePath = id;
    return { metadata, value: '' };
}

async function writeDiscord(id, md, target, ch, request) {
    const limit = (ch.isNitro ? 25 : 10) * 1024 * 1024;
    const res = await fetchSource(request, id);
    const size = sizeOf(md, res);
    if (size > limit) {
        throw new Error(`Discord 单文件上限 ${ch.isNitro ? 25 : 10}MB，该文件 ${(size / 1024 / 1024).toFixed(1)}MB`);
    }
    const buf = await buffered(res, limit, 'Discord');
    const api = new DiscordAPI(ch.botToken);
    const response = await api.sendFile(new Blob([buf], { type: md.FileType || 'application/octet-stream' }), ch.channelId, md.FileName);
    const info = api.getFileInfo(response);
    if (!info) throw new Error('Discord 未返回文件信息');
    const metadata = baseMetadata(md, target, ch.name || 'Discord_env');
    metadata.DiscordMessageId = info.message_id;
    if (info.file_size) metadata.FileSize = (info.file_size / 1024 / 1024).toFixed(2);
    return { metadata, value: '' };
}

async function writeHuggingFace(id, md, target, ch, request) {
    if (!ch.token || !ch.repo) throw new Error('HuggingFace 通道配置不完整');
    const res = await fetchSource(request, id);
    const buf = await buffered(res, BUFFER_LIMIT, 'HuggingFace');
    const uuid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const hfPath = `${uuid}_${id.split('/').pop()}`;
    const api = new HuggingFaceAPI(ch.token, ch.repo, !!ch.isPrivate);
    const r = await api.uploadFile(new File([buf], md.FileName || 'file', { type: md.FileType || 'application/octet-stream' }), hfPath, 'Transfer ' + (md.FileName || hfPath));
    if (!r || !r.success) throw new Error('HuggingFace 上传失败');
    const metadata = baseMetadata(md, target, ch.name || 'HuggingFace_env');
    metadata.HfFilePath = hfPath;
    return { metadata, value: '' };
}

async function writeTelegram(id, md, target, ch, request) {
    if (!ch.botToken || !ch.chatId) throw new Error('Telegram 通道配置不完整');
    const res = await fetchSource(request, id);
    const size = sizeOf(md, res);
    const api = new TelegramAPI(ch.botToken, ch.proxyUrl || '');
    const fileName = md.FileName || id.split('/').pop() || 'file';
    const fileType = md.FileType || 'application/octet-stream';
    const MAX_PARTS = target.maxParts || 48;
    const MAX_BYTES = target.maxFileBytes || MAX_PARTS * TG_CHUNK_SIZE;
    const tooLarge = () => new Error(
        `Telegram 单文件最多约 ${Math.round(MAX_BYTES / 1024 / 1024)}MB（${MAX_PARTS} 段 × 16MB）—— `
        + 'Cloudflare 免费版单次请求最多发 50 个子请求，而"转移"这一个请求里要 1 次取源文件 + 每段 1 次上传，'
        + '段数必须留余量。绕开办法：先下载到本地再直接上传（浏览器分片不受此限），或先转到 R2 / S3（流式转发，无上限）。'
    );

    // 小文件：保持与上传链路一致（图片/视频走 sendPhoto/sendVideo，TG 里能直接预览）
    if (size && size <= TG_CHUNK_SIZE) {
        const buf = await buffered(res, BUFFER_LIMIT, 'Telegram');
        const sendFn = tgSendFunction(fileType, (fileName.split('.').pop() || '').toLowerCase());
        const response = await api.sendFile(new Blob([buf], { type: fileType }), ch.chatId, sendFn.url, sendFn.type);
        const info = api.getFileInfo(response);
        if (!info || !info.file_id) throw new Error('Telegram 未返回文件信息');
        const metadata = baseMetadata(md, target, ch.name || 'Telegram_env');
        metadata.TgFileId = info.file_id;
        if (info.file_size) metadata.FileSize = (info.file_size / 1024 / 1024).toFixed(2);
        return { metadata, value: '' };
    }

    // 大文件：**流式** 按 16MB 分段投递，内存里只保留一段
    // （早期版本是整包 arrayBuffer 缓冲，受 Worker 内存限制只能到 80MB；现在限制来自段数上限）
    const chunks = [];
    const reader = res.body.getReader();
    let pending = new Uint8Array(0);
    let idx = 0;
    let totalBytes = 0;

    const sendPart = async (bytes, index) => {
        const chunkName = `${fileName}.part${String(index).padStart(3, '0')}`;
        let info = null;
        let lastErr = '';
        for (let attempt = 0; attempt < 3 && !info; attempt++) {
            try {
                const r = await api.sendFile(new Blob([bytes], { type: fileType }), ch.chatId, 'sendDocument', 'document', `Part ${index + 1}`, chunkName);
                const got = api.getFileInfo(r);
                if (got && got.file_id) info = got;
                else lastErr = '返回信息不完整';
            } catch (err) {
                lastErr = err.message;
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
        if (!info) throw new Error(`Telegram 分片 ${index + 1} 上传失败：${lastErr}`);
        chunks.push({ index, fileId: info.file_id, size: info.file_size, fileName: chunkName });
        totalBytes += info.file_size || bytes.byteLength;
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending, 0);
        merged.set(value, pending.length);
        pending = merged;
        while (pending.length >= TG_CHUNK_SIZE) {
            if (idx + 1 > MAX_PARTS) {
                throw tooLarge();
            }
            await sendPart(pending.slice(0, TG_CHUNK_SIZE), idx++);
            pending = pending.slice(TG_CHUNK_SIZE);
        }
    }
    if (pending.length) {
        if (idx + 1 > MAX_PARTS) {
            throw tooLarge();
        }
        await sendPart(pending, idx++);
    }
    if (!chunks.length) throw new Error('源文件为空，无法转移');

    const metadata = baseMetadata(md, target, ch.name || 'Telegram_env');
    if (chunks.length === 1) {
        metadata.TgFileId = chunks[0].fileId;
    } else {
        metadata.IsChunked = true;
        metadata.TotalChunks = chunks.length;
    }
    metadata.FileSize = (totalBytes / 1024 / 1024).toFixed(2);
    // 单段就直接存空值；多段要把分段清单写进 value（读取时按清单重组）
    return { metadata, value: chunks.length === 1 ? '' : JSON.stringify(chunks) };
}

/** 与上传链路一致：按 MIME 选 TG 的发送接口，图片/视频能在 TG 里直接预览 */
function tgSendFunction(fileType, fileExt) {
    if (fileType === 'image/gif' || fileType === 'image/webp' || fileExt === 'gif' || fileExt === 'webp') {
        return { url: 'sendAnimation', type: 'animation' };
    }
    if (fileType.indexOf('image/') === 0) return { url: 'sendPhoto', type: 'photo' };
    if (fileType.indexOf('video/') === 0) return { url: 'sendVideo', type: 'video' };
    if (fileType.indexOf('audio/') === 0) return { url: 'sendAudio', type: 'audio' };
    return { url: 'sendDocument', type: 'document' };
}

/** 清理源渠道的物理副本（TG 无删除能力，与项目既有的「删除文件」行为一致，跳过） */
async function cleanupSourceChannel(env, id, md, request) {
    const from = md.Channel || '';
    const db = getDatabase(env);
    try {
        if (from === 'CloudflareR2' && env.img_r2) {
            await env.img_r2.delete(id);
        } else if (from === 'S3') {
            const c = await resolveS3Credentials(db, env, md);
            if (c && c.endpoint) {
                const client = new S3Client({
                    region: c.region || 'auto',
                    endpoint: c.endpoint,
                    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
                    forcePathStyle: !!c.pathStyle,
                });
                await client.send(new DeleteObjectCommand({ Bucket: c.bucketName, Key: c.key || id }));
            }
        } else if (from === 'Discord') {
            const c = await resolveDiscordCredentials(db, env, md);
            if (c && c.botToken && c.channelId && c.messageId) {
                await new DiscordAPI(c.botToken).deleteMessage(c.channelId, c.messageId);
            }
        } else if (from === 'HuggingFace') {
            const c = await resolveHuggingFaceCredentials(db, env, md);
            if (c && c.token && c.repo && c.filePath) {
                await new HuggingFaceAPI(c.token, c.repo, !!c.isPrivate).deleteFile(c.filePath, `Transfer away ${c.filePath}`);
            }
        } else if (from === 'WebDAV') {
            const filePath = md.WebDAVFilePath;
            if (filePath) {
                const c = await resolveWebDAVCredentials(db, env, md);
                if (c && c.baseUrl) await new WebDAVAPI(c).deleteFile(filePath);
            }
        }
    } catch (e) {
        // 源副本清理失败不影响转移结果（文件已经在新渠道可读），仅记日志
        console.warn('cleanup source channel failed for', id, e && e.message);
    }

    // 清掉直链与列表缓存，否则前端仍可能读到旧渠道的响应
    try {
        const u = new URL(request.url);
        await purgeCFCache(env, `https://${u.hostname}/file/${id}`);
        const folder = id.split('/').slice(0, -1).join('/');
        await purgeRandomFileListCache(u.origin, folder);
        await purgePublicFileListCache(u.origin, folder);
    } catch (e) {
        console.warn('purge cache failed:', e && e.message);
    }
}
