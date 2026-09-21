/**
 * 存储通道注册表 —— 全项目「通道类型」的唯一事实来源。
 *
 * 设计目标：**不要在任何地方写死 `cfr2` / `telegram`**。
 * 新增一种存储通道 = 只在这里加一条记录（含前端表单字段 schema 与图标），
 * 后台「存储通道」页、网盘通道选择器、徽标标签、配额统计、转通道目标
 * 全部自动跟着变。
 *
 * 术语：
 *   key           渠道组名，同时也是 `/upload/?uploadChannel=<key>` 的取值（'cfr2' | 'telegram' | …）
 *   channel       写进文件 metadata 的 `Channel` 字段（'CloudflareR2' | 'TelegramNew' | …）
 *   name          同一种 key 下的**具体通道实例名**（如 'R2_env'、'R2_backup'），
 *                 多渠道时上传要带 `&channelName=<name>` 才能指定实例
 *   configurable  是否有独立的配置组（external 没有，它只是把外链写进 metadata）
 *   connectable   能否作为上传/转移的目标渠道
 *   icon          24×24 stroke 图标的内部 SVG 片段（前端直接拼进 <svg viewBox="0 0 24 24">）
 */

/* 表单字段类型：text | password | number | checkbox */

const ICON = {
    telegram: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    cfr2: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    s3: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    discord: '<rect x="2" y="7" width="20" height="12" rx="4"/><circle cx="8.5" cy="13" r="1.3"/><circle cx="15.5" cy="13" r="1.3"/>',
    huggingface: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.2c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/><circle cx="9.2" cy="10.3" r=".7"/><circle cx="14.8" cy="10.3" r=".7"/>',
    webdav: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.7 3.6 5.7 3.6 9s-1.2 6.3-3.6 9c-2.4-2.7-3.6-5.7-3.6-9S9.6 5.7 12 3z"/>',
    external: '<path d="M10.6 13.4a4.5 4.5 0 0 0 6.4 0l2.5-2.5a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M13.4 10.6a4.5 4.5 0 0 0-6.4 0L4.5 13.1a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
};

export const CHANNEL_TYPES = [
    {
        key: 'telegram',
        channel: 'TelegramNew',
        label: 'Telegram',
        shortLabel: 'TG',
        color: '#29A9EB',
        icon: ICON.telegram,
        configurable: true,
        connectable: true,
        streamTransfer: false,          // 转移时按 16MB 分段流式投递
        // ⚠️ 这两个数不是随便定的，卡的是 Cloudflare 的**子请求上限**：
        //    Workers 免费版单次请求最多 50 个外部子请求（付费版 10,000）。
        //    转移 TG 时每个分片要发一次 sendDocument，外加 1 次取源文件 →
        //    48 段 + 1 次取源 = 49，尚在 50 以内且留了 1 次重试余量。
        //    16MB 这个段大小则来自「TG Bot getFile 下载上限 20MB，留 4MB 余量」。
        //    所以 48 × 16MB = 768MB。付费账号可以把这个数调大（配合改 maxFileBytes）。
        //    注意：**直传不受这个限制**（>24MB 由浏览器分片，每片是独立请求，Worker 每次只发 1~2 个子请求）。
        maxParts: 48,
        maxFileBytes: 768 * 1024 * 1024,
        defaultName: 'Telegram_env',
        fields: [
            { k: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...', hint: '在 Telegram 里找 @BotFather 创建机器人后拿到的 token。' },
            { k: 'chatId', label: 'Chat ID', type: 'text', required: true, placeholder: '-1001234567890', hint: '文件实际存放的频道/群 ID，一般是 -100 开头的负数。' },
            { k: 'proxyUrl', label: '代理域名（可选）', type: 'text', placeholder: 'tg-proxy.example.com', envMutable: true, hint: '填了之后会通过这个反代域名访问 api.telegram.org。直连很慢时强烈建议配 —— 实测能差好几倍速度。' },
        ],
    },
    {
        key: 'cfr2',
        channel: 'CloudflareR2',
        label: 'Cloudflare R2',
        shortLabel: 'R2',
        color: '#F6821F',
        icon: ICON.cfr2,
        configurable: true,
        connectable: true,
        streamTransfer: true,           // 转移走流式直写，没有缓冲上限
        maxFileBytes: null,
        defaultName: 'R2_env',
        fields: [
            {
                k: 'publicUrl', label: '公开访问 URL（可选）', type: 'text', envMutable: true,
                placeholder: 'https://pub-xxxx.r2.dev',
                hint: '指的是你给 R2 存储桶绑定的「公开访问域名」（形如 https://pub-xxxx.r2.dev 或你自己的域名）。'
                    + '⚠️ 建议留空：它全项目只有一个用途 —— 开启「内容审核」后，把文件的公开地址交给审核服务去抓取。'
                    + '本站直链 /file/xxx、分享链接、以及上传接口返回的 publicUrl 都**不依赖它**'
                    + '（上传返回的 publicUrl 由「系统设置 → 页面配置 → 自定义 URL 前缀 urlPrefix」决定，与本字段无关）。'
                    + '⚠️ 不要填 S3 API 端点（形如 xxx.r2.cloudflarestorage.com）—— 那个地址必须 AWS 签名才能访问，'
                    + '匿名请求一律返回 400 InvalidArgument / Authorization，永远打不开文件。',
            },
        ],
    },
    {
        key: 's3',
        channel: 'S3',
        label: 'S3 兼容存储',
        shortLabel: 'S3',
        color: '#569A31',
        icon: ICON.s3,
        configurable: true,
        connectable: true,
        streamTransfer: false,
        maxFileBytes: null,
        defaultName: 'S3_env',
        fields: [
            { k: 'endpoint', label: 'Endpoint', type: 'text', required: true, placeholder: 'https://s3.example.com', hint: 'S3 兼容服务的接入地址，例如 AWS 是 https://s3.us-east-1.amazonaws.com。' },
            { k: 'bucketName', label: 'Bucket 名称', type: 'text', required: true },
            { k: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true },
            { k: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
            { k: 'region', label: 'Region', type: 'text', placeholder: 'auto', hint: 'AWS 填真实区域（如 us-east-1）；Cloudflare R2 / MinIO 一般填 auto。' },
            { k: 'pathStyle', label: '使用 Path Style 寻址', type: 'checkbox', hint: 'MinIO、部分自建 S3 必须开启；AWS 官方一般关闭。' },
            { k: 'cdnDomain', label: 'CDN 域名（可选）', type: 'text', envMutable: true, hint: '给这个桶配的 CDN/自定义域名，仅用于返回访问链接。' },
        ],
    },
    {
        key: 'discord',
        channel: 'Discord',
        label: 'Discord',
        shortLabel: 'DC',
        color: '#5865F2',
        icon: ICON.discord,
        configurable: true,
        connectable: true,
        streamTransfer: false,
        maxFileBytes: 25 * 1024 * 1024,   // 免费 10MB / Nitro 25MB
        defaultName: 'Discord_env',
        fields: [
            { k: 'botToken', label: 'Bot Token', type: 'password', required: true, hint: 'Discord 开发者后台建立的机器人 token。' },
            { k: 'channelId', label: '频道 ID', type: 'text', required: true, hint: '文件要发到哪个文字频道的 ID。' },
            { k: 'proxyUrl', label: '代理域名（可选）', type: 'text', envMutable: true, hint: '用于加速访问 cdn.discordapp.com。' },
            { k: 'isNitro', label: '该账号是 Nitro（单文件上限 25MB，否则 10MB）', type: 'checkbox', envMutable: true },
        ],
    },
    {
        key: 'huggingface',
        channel: 'HuggingFace',
        label: 'HuggingFace',
        shortLabel: 'HF',
        color: '#FFD21E',
        icon: ICON.huggingface,
        configurable: true,
        connectable: true,
        streamTransfer: false,
        maxFileBytes: null,
        defaultName: 'HuggingFace_env',
        fields: [
            { k: 'token', label: 'Access Token', type: 'password', required: true, hint: 'HuggingFace 设置页里的 Access Token（需要 write 权限）。' },
            { k: 'repo', label: '仓库（user/repo）', type: 'text', required: true, placeholder: 'username/dataset', hint: '文件会被提交到这个仓库，建议用 Dataset 类型。' },
            { k: 'isPrivate', label: '私有仓库', type: 'checkbox', envMutable: true, hint: '私有仓库的文件不能通过公开链接访问，只能走本站 /file/xxx。' },
        ],
    },
    {
        key: 'webdav',
        channel: 'WebDAV',
        label: 'WebDAV',
        shortLabel: 'DAV',
        color: '#0EA5E9',
        icon: ICON.webdav,
        configurable: true,
        connectable: true,
        streamTransfer: false,
        maxFileBytes: null,
        defaultName: 'WebDAV_env',
        chunkedUnsupported: true,        // 不支持客户端分片上传
        fields: [
            { k: 'baseUrl', label: 'WebDAV 地址', type: 'text', required: true, placeholder: 'https://dav.example.com/remote.php/dav/files/user', hint: '坚果云 / Nextcloud 等给出的 WebDAV 根地址。' },
            { k: 'username', label: '用户名', type: 'text' },
            { k: 'password', label: '密码', type: 'password', hint: '坚果云这类服务要用「应用密码」，不是登录密码。' },
            { k: 'publicUrl', label: '公开访问 URL（可选）', type: 'text', envMutable: true },
        ],
    },
    {
        // 外链渠道：不存文件本体，只把外部 URL 写进 metadata.ExternalLink
        key: 'external',
        channel: 'External',
        label: '外链',
        shortLabel: 'URL',
        color: '#8A82B8',
        icon: ICON.external,
        configurable: false,
        connectable: false,
        streamTransfer: false,
        maxFileBytes: null,
        defaultName: 'External',
        fields: [],
    },
];

export const CHANNEL_TYPE_BY_KEY = Object.fromEntries(CHANNEL_TYPES.map(t => [t.key, t]));
export const CHANNEL_TYPE_BY_CHANNEL = Object.fromEntries(CHANNEL_TYPES.map(t => [t.channel, t]));

/** 有独立配置组的通道类型（= 后台可增删改的那些） */
export const CONFIGURABLE_CHANNEL_TYPES = CHANNEL_TYPES.filter(t => t.configurable);

/** 不需要配置组、但要出现在统计里的类型（外链） */
export const PASSTHROUGH_CHANNEL_TYPES = CHANNEL_TYPES.filter(t => !t.configurable);

/** key 或 metadata.Channel 都能查到类型定义 */
export function channelTypeOf(value) {
    if (!value) return null;
    return CHANNEL_TYPE_BY_KEY[value] || CHANNEL_TYPE_BY_CHANNEL[value] || null;
}

/** metadata.Channel → key */
export function channelKeyOf(metaChannel) {
    return channelTypeOf(metaChannel)?.key || String(metaChannel || '');
}

/** 任意输入 → 展示用全名（查不到就原样返回，绝不显示空白） */
export function channelLabelOf(value) {
    return channelTypeOf(value)?.label || String(value || '未知通道');
}

/** 任意输入 → 徽标短名（R2 / TG / DC …） */
export function channelShortOf(value) {
    return channelTypeOf(value)?.shortLabel || String(value || '?');
}

export function channelColorOf(value) {
    return channelTypeOf(value)?.color || '#8A82B8';
}

/** 展示名：同类型只有一个实例时只显示类型名，多个实例时带实例名区分 */
export function buildDisplayName(type, name, sameTypeCount = 1) {
    const label = type?.label || String(name || '通道');
    if (!type) return String(name || '通道');
    if (sameTypeCount > 1 && name) return `${label} · ${name}`;
    return label;
}
