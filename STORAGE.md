# 存储通道配置

FileStore 支持多种存储通道，可自由组合。配置方式有两种：

- **环境变量**：在 Cloudflare Pages 项目设置中添加，适合快速部署
- **后台配置**：部署后在管理后台 `/admin.html` → 上传设置中添加，支持多通道和负载均衡

---

## Telegram

> 通过分片上传绕过大小限制，支持上传任意大小的文件

### 前置要求

- Cloudflare 账号
- Telegram 账号

### 第一步：获取 Telegram 凭据

1. **获取 Bot Token**
   - 向 [@BotFather](https://t.me/BotFather) 发送 `/newbot`
   - 按提示创建机器人，获得 `BOT_TOKEN`

2. **创建频道并添加机器人**
   - 创建一个新的 Telegram 频道（私有或公开均可）
   - 将机器人添加为频道管理员（给予发布消息权限）

3. **获取 Chat ID**
   - 向 [@VersaToolsBot](https://t.me/VersaToolsBot) 或 [@GetTheirIDBot](https://t.me/GetTheirIDBot) 发送消息
   - 获取频道 ID（格式为 `-100xxxxxxxxxx`）

### 第二步：配置环境变量

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `TG_BOT_TOKEN` | Telegram Bot Token | ✅ |
| `TG_CHAT_ID` | Telegram 频道 ID | ✅ |
| `TG_PROXY_URL` | 代理地址（如 `proxy.example.com`） | 可选 |

### 第三步：重新部署

修改环境变量后需在 Cloudflare Pages 项目中触发重新部署。

---

## Cloudflare R2

> 单文件上限 5GB（分片上传），免费额度：10GB 存储 + 100万次 Class A 操作/月

### 前置要求

- Cloudflare 账号（R2 需要绑定计费套餐，但免费额度内不收费）

### 第一步：创建存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 `R2 对象存储` → `创建存储桶`
3. 建议命名为 `filestore-files`
4. 记下存储桶名称

### 第二步：获取 API 凭据

1. 进入 `R2` → `管理 R2 API 令牌`
2. 创建 API 令牌，权限选择 `对象读写`
3. 记下 `Access Key ID` 和 `Secret Access Key`

### 第三步：配置环境变量

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | ✅ |
| `R2_ACCESS_KEY_ID` | R2 Access Key ID | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key | ✅ |
| `R2_BUCKET_NAME` | R2 存储桶名称 | ✅ |
| `R2_PUBLIC_URL` | 自定义域名（可选，用于加速访问） | 可选 |

### 第四步：绑定存储桶（推荐）

1. 进入 Pages 项目 → `设置` → `函数` → `KV 命名空间绑定`
2. 添加绑定，变量名设为 `img_r2`，选择刚创建的 R2 存储桶

> 绑定后可直接通过环境变量启用，无需在后台手动配置。

---

## S3 兼容存储

> 支持任何 S3 兼容服务：AWS S3、MinIO、BackBlaze B2、阿里云 OSS 等

### 环境变量配置

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `S3_ENDPOINT` | S3 端点 URL | ✅ |
| `S3_REGION` | 区域（如 `us-east-1`） | ✅ |
| `S3_ACCESS_KEY_ID` | 访问密钥 ID | ✅ |
| `S3_SECRET_ACCESS_KEY` | 秘密访问密钥 | ✅ |
| `S3_BUCKET_NAME` | 存储桶名称 | ✅ |
| `S3_PATH_STYLE` | 使用路径风格访问（MinIO 等设为 `true`） | 可选 |
| `S3_CDN_DOMAIN` | CDN 加速域名 | 可选 |

### 各平台 Endpoint 示例

| 平台 | Endpoint 格式 | Region 示例 |
| :--- | :--- | :--- |
| AWS S3 | `https://s3.{region}.amazonaws.com` | `us-east-1` |
| MinIO | `https://minio.example.com:9000` | `us-east-1` |
| BackBlaze B2 | `https://s3.{region}.backblazeb2.com` | `us-west-004` |
| 阿里云 OSS | `https://oss-{region}.aliyuncs.com` | `cn-hangzhou` |
| Cloudflare R2 | `https://{account_id}.r2.cloudflarestorage.com` | `auto` |

---

## Discord

> 通过 Discord 频道存储文件，普通用户 25MB/文件，Nitro 用户 50-100MB

### 前置要求

- Discord 账号
- Discord 服务器（需创建频道）

### 方式一：Webhook（推荐，仅上传）

1. 在 Discord 服务器中，右键目标频道 → 整合 → Webhooks
2. 创建新 Webhook，复制 Webhook URL
3. 配置环境变量：

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL | ✅ |

### 方式二：Bot（推荐，支持上传+删除+管理）

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用
2. 在 Bot 标签页创建 Bot，获取 Token
3. 在 OAuth2 → URL Generator 中选择 `bot` scope 和 `Send Messages`、`Attach Files`、`Read Message History` 权限
4. 使用生成的 URL 将 Bot 邀请到服务器
5. 右键目标频道 → 复制频道 ID（需开启开发者模式）
6. 配置环境变量：

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | ✅ |
| `DISCORD_CHANNEL_ID` | Discord 频道 ID | ✅ |
| `DISCORD_IS_NITRO` | Nitro 会员（设为 `true` 启用 50MB） | 可选 |

> Discord 文件 URL 约 24 小时过期，系统会自动刷新，不影响文件访问。

---

## HuggingFace

> 通过 HuggingFace Datasets API 存储，普通上传 35MB/文件，LFS 上传可达 50GB

### 前置要求

- HuggingFace 账号

### 第一步：创建仓库

1. 注册/登录 [HuggingFace](https://huggingface.co)
2. 进入 Settings → New Dataset，创建新仓库
3. 记下仓库 ID（格式为 `username/repo-name`）

### 第二步：获取 Token

1. 前往 [Settings → Access Tokens](https://huggingface.co/settings/tokens)
2. 创建 Token，权限选择 **Write**
3. 记下 Token（格式为 `hf_xxxxxxxxxxxx`）

### 第三步：配置环境变量

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `HF_TOKEN` | HuggingFace Write 权限 Token | ✅ |
| `HF_REPO` | Dataset 仓库 ID（如 `username/my-filebed`） | ✅ |
| `HF_PRIVATE` | 设为 `true` 创建私有仓库 | 可选 |

---

## WebDAV

> 支持任何 WebDAV 服务：坚果云、NextCloud、自建等

### 环境变量配置

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `WEBDAV_BASE_URL` | WebDAV 服务地址（如 `https://dav.jianguoyun.com/dav/`） | ✅ |
| `WEBDAV_USERNAME` | 用户名 | ✅ |
| `WEBDAV_PASSWORD` | 密码或应用专用密码 | ✅ |
| `WEBDAV_HEADERS` | 自定义请求头（JSON 格式） | 可选 |

---

## 各通道文件大小限制

| 存储通道 | 单文件上限 | 备注 |
| :--- | :--- | :--- |
| Telegram | 无限制 | 分片上传，每片16MB |
| Cloudflare R2 | 5GB | 分片上传 |
| S3 兼容存储 | 5GB | 分片上传 |
| Discord（普通） | 25MB | 无分片 |
| Discord（Nitro） | 50-100MB | 无分片 |
| HuggingFace | 无限制 | 普通上传35MB，LFS可达50GB |
| WebDAV | 取决于服务端 | 无分片 |

---

## 负载均衡

FileStore 支持同一通道类型配置多个账号，自动轮询分配上传任务。

配置方式：部署后进入管理后台 → 上传设置 → 选择通道 → 添加多个通道实例。

---

## 常见问题

**Q: 修改环境变量后不生效？**
A: 需要在 Cloudflare Pages 项目中触发重新部署。进入项目 → 部署 → 点击"重新部署"。

**Q: 如何同时使用多个通道？**
A: 环境变量可配置多个通道，也可以在管理后台 → 上传设置中添加更多通道。系统会按优先级轮询上传。

**Q: R2 和 S3 有什么区别？**
A: R2 是 Cloudflare 自家的 S3 兼容存储，免出站流量费。S3 可选 AWS、阿里云等任何兼容服务。
