/**
 * 存储通道连通性测试 —— 每种通道类型一个探针。
 *
 * 设计原则：
 *   1. **只读**。所有探针都不写入、不删除任何东西（Telegram 用 getMe/getChat，
 *      S3 用 HeadBucket，WebDAV 用 Depth:0 的 PROPFIND，等等）。
 *   2. **不写死通道清单**。按 key 分派，key 来自 channelRegistry。
 *   3. **把原始错误原样带回去**，否则用户只知道"失败"却不知道该改哪一项。
 *
 * 返回统一结构：{ ok, ms, summary, steps: [{ name, ok, message }] }
 */

import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

const TIMEOUT_MS = 15000;

/** 带超时的 fetch —— 通道测试必须自己控时，否则前端会一直转圈 */
async function fetchT(url, options = {}, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/** 网络错误统一成人话 */
function humanError(err) {
    const msg = String((err && err.message) || err || '');
    if (/abort/i.test(msg)) return `连接超时（超过 ${TIMEOUT_MS / 1000} 秒没有响应）`;
    if (/ENOTFOUND|getaddrinfo|dns/i.test(msg)) return '域名解析失败，请检查地址是否拼错';
    if (/fetch failed|network|ECONNREFUSED/i.test(msg)) return '网络不可达（Worker 侧无法连接该地址）';
    return msg || '未知错误';
}

/** 读响应体并尽量转成 JSON，失败则返回纯文本片段 */
async function readJson(res) {
    const text = await res.text();
    try {
        return { json: JSON.parse(text), text };
    } catch {
        return { json: null, text };
    }
}

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */
async function testTelegram(ch) {
    const steps = [];
    if (!ch.botToken) return { ok: false, steps: [{ name: '配置检查', ok: false, message: '缺少 Bot Token' }] };

    const api = ch.proxyUrl ? `https://${ch.proxyUrl}` : 'https://api.telegram.org';
    const base = `${api}/bot${ch.botToken}`;

    // 1) getMe —— 校验 token 本身
    let botName = '';
    try {
        const res = await fetchT(`${base}/getMe`);
        const { json } = await readJson(res);
        if (json && json.ok) {
            botName = (json.result && (json.result.username || json.result.first_name)) || '';
            steps.push({ name: 'Bot Token', ok: true, message: `有效，机器人 @${botName}` });
        } else {
            const desc = (json && json.description) || `HTTP ${res.status}`;
            steps.push({ name: 'Bot Token', ok: false, message: `无效：${desc}` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: 'Bot Token', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    // 2) getChat —— 校验 chatId 存在且机器人能看到
    if (!ch.chatId) {
        steps.push({ name: 'Chat ID', ok: false, message: '未填写 Chat ID' });
        return { ok: false, steps };
    }
    try {
        const res = await fetchT(`${base}/getChat?chat_id=${encodeURIComponent(ch.chatId)}`);
        const { json } = await readJson(res);
        if (json && json.ok) {
            const t = (json.result && (json.result.title || json.result.username)) || ch.chatId;
            steps.push({ name: 'Chat ID', ok: true, message: `可访问：${t}` });
        } else {
            const desc = (json && json.description) || `HTTP ${res.status}`;
            steps.push({ name: 'Chat ID', ok: false, message: `不可访问：${desc}` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: 'Chat ID', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    if (ch.proxyUrl) steps.push({ name: '代理域名', ok: true, message: `已启用 ${ch.proxyUrl}` });
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* Cloudflare R2（走环境变量里的桶绑定）                                 */
/* ------------------------------------------------------------------ */
async function testCfr2(ch, env) {
    const steps = [];
    if (!env || typeof env.img_r2 === 'undefined' || env.img_r2 === null || env.img_r2 === '') {
        return { ok: false, steps: [{ name: '存储桶绑定', ok: false, message: '环境变量里没有绑定 R2 存储桶（img_r2）' }] };
    }
    try {
        // 只读探测：拉一条记录确认桶可访问
        await env.img_r2.list({ limit: 1 });
        steps.push({ name: '存储桶绑定', ok: true, message: '可读写（已通过只读列表验证）' });
    } catch (err) {
        steps.push({ name: '存储桶绑定', ok: false, message: `访问失败：${humanError(err)}` });
        return { ok: false, steps };
    }

    // 公开访问 URL 是**可选项**，它不通不影响上传/下载，所以失败不判为致命
    if (ch.publicUrl) {
        try {
            const res = await fetchT(ch.publicUrl, { method: 'HEAD' });
            const s = res.status;
            if (s === 400 || s === 403) {
                steps.push({
                    name: '公开访问 URL', ok: false, fatal: false,
                    message: `返回 HTTP ${s} —— 这是 S3 API 端点拒绝匿名访问（它要求 AWS 签名），说明填错成 xxx.r2.cloudflarestorage.com 了。`
                        + '该字段是可选的，建议直接留空：本站直链 /file/xxx、分享链接、上传接口返回的 publicUrl 都不依赖它，'
                        + '只有开启「内容审核」时才需要它',
                });
            } else if (s >= 500) {
                steps.push({ name: '公开访问 URL', ok: false, fatal: false, message: `返回 HTTP ${s}，域名可达但服务端异常` });
            } else if (s === 404) {
                // 桶根路径没有对象时返回 404 是正常的，能拿到 404 就说明域名通了
                steps.push({ name: '公开访问 URL', ok: true, message: '域名可达（根路径 404 属正常，桶内没有同名对象）' });
            } else if (s >= 400) {
                steps.push({ name: '公开访问 URL', ok: false, fatal: false, message: `返回 HTTP ${s}` });
            } else {
                steps.push({ name: '公开访问 URL', ok: true, message: `可访问（HTTP ${s}）` });
            }
        } catch (err) {
            steps.push({ name: '公开访问 URL', ok: false, fatal: false, message: humanError(err) });
        }
    } else {
        steps.push({ name: '公开访问 URL', ok: true, message: '未配置（不影响使用，文件走本站 /file/ 链接）' });
    }
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* S3 兼容存储                                                          */
/* ------------------------------------------------------------------ */
function s3ErrorHint(err) {
    const name = (err && err.name) || '';
    const status = (err && err.$metadata && err.$metadata.httpStatusCode) || (err && err.statusCode) || 0;
    if (name === 'NotFound' || status === 404) return '桶不存在或端点地址不对（404）';
    if (name === 'Forbidden' || status === 403) return '凭据被拒绝，或该密钥没有访问这个桶的权限（403）';
    if (status === 301) return '区域（Region）填错了，服务端要求换到别的区域（301）';
    if (name === 'CredentialsProviderError') return 'Access Key / Secret 没填全';
    return `请求失败：${(err && err.message) || '未知错误'}${status ? `（HTTP ${status}）` : ''}`;
}

async function testS3(ch) {
    const steps = [];
    const missing = ['endpoint', 'bucketName', 'accessKeyId', 'secretAccessKey'].filter(k => !ch[k]);
    if (missing.length) {
        return { ok: false, steps: [{ name: '配置检查', ok: false, message: '缺少必填项：' + missing.join(' / ') }] };
    }

    let client;
    try {
        client = new S3Client({
            region: ch.region || 'auto',
            endpoint: ch.endpoint,
            forcePathStyle: !!ch.pathStyle,
            credentials: { accessKeyId: ch.accessKeyId, secretAccessKey: ch.secretAccessKey },
        });
    } catch (err) {
        return { ok: false, steps: [{ name: '客户端初始化', ok: false, message: humanError(err) }] };
    }

    try {
        // HeadBucket 是最轻的只读探测：验证端点 + 签名 + 桶存在 + 权限
        await client.send(new HeadBucketCommand({ Bucket: ch.bucketName }), { requestTimeout: TIMEOUT_MS });
        steps.push({ name: '桶访问', ok: true, message: `可访问：${ch.bucketName}` });
    } catch (err) {
        steps.push({ name: '桶访问', ok: false, message: s3ErrorHint(err) });
        return { ok: false, steps };
    }

    steps.push({ name: '端点', ok: true, message: ch.endpoint + (ch.pathStyle ? '（Path Style）' : '') });
    if (ch.cdnDomain) steps.push({ name: 'CDN 域名', ok: true, message: ch.cdnDomain });
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* Discord                                                             */
/* ------------------------------------------------------------------ */
async function testDiscord(ch) {
    const steps = [];
    if (!ch.botToken) return { ok: false, steps: [{ name: '配置检查', ok: false, message: '缺少 Bot Token' }] };
    const headers = { Authorization: `Bot ${ch.botToken}`, 'User-Agent': 'CloudFlare-ImgBed' };

    // 1) 机器人身份
    try {
        const res = await fetchT('https://discord.com/api/v10/users/@me', { headers });
        const { json } = await readJson(res);
        if (res.ok && json) {
            steps.push({ name: 'Bot Token', ok: true, message: `有效，机器人 ${json.username || json.id}` });
        } else {
            const desc = (json && (json.message || json.error)) || `HTTP ${res.status}`;
            steps.push({ name: 'Bot Token', ok: false, message: `无效（HTTP ${res.status}）：${desc}` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: 'Bot Token', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    // 2) 频道可写
    if (!ch.channelId) {
        steps.push({ name: '频道 ID', ok: false, message: '未填写频道 ID' });
        return { ok: false, steps };
    }
    try {
        const res = await fetchT(`https://discord.com/api/v10/channels/${ch.channelId}`, { headers });
        const { json } = await readJson(res);
        if (res.ok && json) {
            steps.push({ name: '频道 ID', ok: true, message: `可访问：#${json.name || ch.channelId}` });
        } else {
            const desc = (json && (json.message || json.error)) || `HTTP ${res.status}`;
            steps.push({ name: '频道 ID', ok: false, message: `不可访问（HTTP ${res.status}）：${desc}` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: '频道 ID', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    steps.push({ name: '单文件上限', ok: true, message: ch.isNitro ? '25 MB（Nitro）' : '10 MB（免费档）' });
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* HuggingFace                                                         */
/* ------------------------------------------------------------------ */
async function testHuggingFace(ch) {
    const steps = [];
    if (!ch.token) return { ok: false, steps: [{ name: '配置检查', ok: false, message: '缺少 Access Token' }] };
    const headers = { Authorization: `Bearer ${ch.token}` };

    try {
        const res = await fetchT('https://huggingface.co/api/whoami-v2', { headers });
        const { json } = await readJson(res);
        if (res.ok && json) {
            const name = json.name || (json.user && json.user.name) || '';
            const canWrite = !json.auth || !json.auth.accessToken || !json.auth.accessToken.role || json.auth.accessToken.role === 'write';
            steps.push({ name: 'Access Token', ok: true, message: `有效${name ? `，账号 ${name}` : ''}` });
            if (!canWrite) {
                steps.push({ name: '写入权限', ok: false, message: `该 Token 是只读（role=${json.auth.accessToken.role}），无法上传，请在 HF 重新签发 write 权限的 Token` });
                return { ok: false, steps };
            }
        } else {
            steps.push({ name: 'Access Token', ok: false, message: `无效（HTTP ${res.status}）` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: 'Access Token', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    if (!ch.repo) {
        steps.push({ name: '仓库', ok: false, message: '未填写仓库（user/repo）' });
        return { ok: false, steps };
    }
    // 仓库可能在 datasets 或 models 下，两个都试
    let found = '';
    for (const kind of ['datasets', 'models']) {
        try {
            const res = await fetchT(`https://huggingface.co/api/${kind}/${ch.repo}`, { headers });
            if (res.ok) { found = kind === 'datasets' ? 'Dataset' : 'Model'; break; }
        } catch {
            /* 继续试下一个 */
        }
    }
    if (found) {
        steps.push({ name: '仓库', ok: true, message: `${found} 类型，可访问：${ch.repo}` });
    } else if (ch.isPrivate) {
        // 私有仓库用 token 也可能查不到（取决于权限范围），但上传时仍会自动创建 → 非致命
        steps.push({ name: '仓库', ok: false, fatal: false, message: `查不到仓库 ${ch.repo}（标记为私有）。若它确实存在，请确认 Token 有该仓库的权限；不存在的话上传时会自动创建` });
    } else {
        steps.push({ name: '仓库', ok: true, message: `暂不存在 ${ch.repo}，上传时自动创建` });
    }
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* WebDAV                                                              */
/* ------------------------------------------------------------------ */
async function testWebDAV(ch) {
    const steps = [];
    if (!ch.baseUrl) return { ok: false, steps: [{ name: '配置检查', ok: false, message: '缺少 WebDAV 地址' }] };

    const headers = {};
    if (ch.username || ch.password) {
        // btoa 只吃 latin1，中文密码要先转 UTF-8
        const raw = `${ch.username || ''}:${ch.password || ''}`;
        const bytes = new TextEncoder().encode(raw);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        headers.Authorization = `Basic ${btoa(bin)}`;
    }

    try {
        // Depth:0 的 PROPFIND 只取自身属性，最轻量的只读探测
        const res = await fetchT(ch.baseUrl, { method: 'PROPFIND', headers: { ...headers, Depth: '0' } });
        if (res.status === 207 || res.status === 200) {
            steps.push({ name: 'WebDAV 连接', ok: true, message: `可访问（HTTP ${res.status}）` });
        } else if (res.status === 401) {
            steps.push({ name: 'WebDAV 连接', ok: false, message: '认证失败（401）：用户名/密码不对，坚果云这类要用「应用密码」' });
            return { ok: false, steps };
        } else if (res.status === 404) {
            steps.push({ name: 'WebDAV 连接', ok: false, message: '地址不存在（404）：请核对完整的 WebDAV 根地址' });
            return { ok: false, steps };
        } else if (res.status === 405) {
            // 有服务器不实现 PROPFIND，但能连上、认证也过了
            steps.push({ name: 'WebDAV 连接', ok: true, message: '服务端不支持 PROPFIND（405），但连接与认证已通过' });
        } else {
            steps.push({ name: 'WebDAV 连接', ok: false, message: `返回 HTTP ${res.status}` });
            return { ok: false, steps };
        }
    } catch (err) {
        steps.push({ name: 'WebDAV 连接', ok: false, message: humanError(err) });
        return { ok: false, steps };
    }

    steps.push({ name: '分片上传', ok: true, message: 'WebDAV 不支持客户端分片，大文件按整文件提交' });
    return { ok: true, steps };
}

/* ------------------------------------------------------------------ */

const PROBES = {
    telegram: testTelegram,
    cfr2: testCfr2,
    s3: testS3,
    discord: testDiscord,
    huggingface: testHuggingFace,
    webdav: testWebDAV,
};

/**
 * 测试一个通道实例的连通性。
 * @param {string} key   通道类型 key（'telegram' | 'cfr2' | …）
 * @param {Object} channel 该实例的配置对象（来自 getUploadConfig 的原始配置）
 * @param {Object} env   Cloudflare 环境变量
 */
export async function testChannelConnectivity(key, channel, env) {
    const probe = PROBES[key];
    if (!probe) {
        return {
            ok: false,
            ms: 0,
            steps: [{ name: '通道类型', ok: false, message: `「${key}」这种通道没有可执行的连通性测试（例如外链通道不存文件本体）` }],
        };
    }
    const t0 = Date.now();
    let result;
    try {
        result = await probe(channel || {}, env);
    } catch (err) {
        result = { ok: false, steps: [{ name: '测试', ok: false, message: humanError(err) }] };
    }
    const ms = Date.now() - t0;
    const failed = result.steps.filter(s => !s.ok);
    // 致命项：导致这个通道无法上传/下载；非致命项（如可选的公开 URL）只提示、不改总体结论
    const fatal = failed.filter(s => s.fatal !== false);
    const ok = fatal.length === 0;
    const warn = failed.length - fatal.length;
    let summary;
    if (!ok) {
        summary = fatal[0].message;
    } else if (warn > 0) {
        summary = `可以正常读写，但有 ${warn} 项配置需要留意（${ms} ms）`;
    } else {
        summary = `连通正常（${ms} ms）`;
    }
    return { ok, ms, summary, steps: result.steps };
}

export { PROBES };
