import { getDatabase } from '../../utils/databaseAdapter.js';
import { filterAutoDeleteTokens } from '../../utils/auth/tokenExpiration.js';
import { getSessionUser } from '../../utils/auth/currentUser.js';

export async function onRequest(context) {
    // API Token管理，支持创建、删除、列出Token
    const {
      request,
      env
    } = context;

    const db = getDatabase(env);
    const url = new URL(request.url)
    const method = request.method

    // GET - 获取所有Token列表
    // ?reveal=<tokenId> 时，仅该条返回完整 token 值（供「复制完整 Token」用）
    if (method === 'GET') {
        const revealId = url.searchParams.get('reveal');
        const payload = await getApiTokens(db, revealId)
        return new Response(JSON.stringify({
            code: 0,
            data: payload,
            // 兼容旧前端：顶层同样给一份
            ...payload,
        }), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    // POST - 创建新Token
    if (method === 'POST') {
        const body = await request.json()
        const { name, permissions, expiresAt = null, autoDelete = false } = body
        let { owner } = body

        if (!name || !Array.isArray(permissions) || permissions.length === 0) {
            // 只有 name 和 permissions 是必需的；owner 可省略（下面自动取当前登录用户）
            return new Response(JSON.stringify({ code: -1, error: '缺少必要参数：至少需要填写名称并勾选一项权限' }), {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
            })
        }

        // owner 只是"备注给谁用"，前端以前没传导致创建一直报缺少参数 → 这里兜底
        if (!owner) {
            try {
                const me = await getSessionUser(env, request)
                if (me) owner = me.username || me.displayName || ''
            } catch (e) { /* 用 admin_session 进来时拿不到 users 记录，走下面的兜底 */ }
            if (!owner) owner = 'admin'
        }

        const token = await createApiToken(db, name, permissions, owner, expiresAt, autoDelete)
        // expiresAt 传 null = 永不过期（不选时间就是永久）
        return new Response(JSON.stringify({ code: 0, data: token, ...token }), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    // DELETE - 删除Token（支持 ?id=xxx，也兼容 /apiTokens/xxx 路径写法）
    if (method === 'DELETE') {
        let tokenId = url.searchParams.get('id')
        if (!tokenId) {
            const m = url.pathname.match(/\/apiTokens\/([^/]+)\/?$/)
            if (m) tokenId = decodeURIComponent(m[1])
        }

        if (!tokenId) {
            return new Response(JSON.stringify({ code: -1, error: '缺少Token ID' }), {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
            })
        }

        const result = await deleteApiToken(db, tokenId)
        return new Response(JSON.stringify({ code: result.error ? -1 : 0, data: result, ...result }), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    // PUT - 更新Token权限
    if (method === 'PUT') {
        const body = await request.json()
        const { tokenId, permissions, expiresAt = null, autoDelete = false } = body

        if (!tokenId || !permissions) {
            return new Response(JSON.stringify({ code: -1, error: '缺少必要参数' }), {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
            })
        }

        const result = await updateApiToken(db, tokenId, permissions, expiresAt, autoDelete)
        return new Response(JSON.stringify({ code: result.error ? -1 : 0, data: result, ...result }), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    return new Response('Method not allowed', { status: 405 })
}

// 获取所有API Token
// revealId: 若传入某个 token 的 id，则仅该条返回完整 token，其余一律打码
async function getApiTokens(db, revealId = null) {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    const tokens = settings.apiTokens?.tokens || {}
    
    // 将 tokens 对象转为数组，并应用向后兼容默认值
    // 过滤掉 internal 类型的 token（不展示在安全设置的 token 列表中）
    const tokenArray = Object.keys(tokens)
        .filter(id => tokens[id].type !== 'internal')
        .map(id => {
            const token = tokens[id]
            return {
                id,
                name: token.name,
                owner: token.owner,
                permissions: token.permissions,
                createdAt: token.createdAt,
                updatedAt: token.updatedAt,
                token: token.token,
                expiresAt: token.expiresAt ?? null,
                autoDelete: token.autoDelete ?? false
            }
        })
    
    // 使用 filterAutoDeleteTokens 识别需要自动删除的 Token
    const { toDelete, toKeep } = filterAutoDeleteTokens(tokenArray)
    
    // 从数据库中删除符合自动删除条件的 Token
    if (toDelete.length > 0) {
        for (const t of toDelete) {
            delete settings.apiTokens.tokens[t.id]
        }
        await db.put('manage@sysConfig@security', JSON.stringify(settings))
    }
    
    // 返回时不包含实际token值（除非显式 reveal），只返回基本信息
    const tokenList = toKeep.map(t => {
        const full = t.token || ''
        const revealed = !!(revealId && t.id === revealId)
        return {
            id: t.id,
            name: t.name,
            owner: t.owner,
            permissions: t.permissions,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            token: revealed ? full : (full ? full.substr(0, 15) + '...' : ''),
            revealed,
            expiresAt: t.expiresAt,
            autoDelete: t.autoDelete
        }
    })
    
    return { tokens: tokenList }
}

// 创建新的API Token
export async function createApiToken(db, name, permissions, owner, expiresAt = null, autoDelete = false, type = 'user') {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    
    if (!settings.apiTokens) {
        settings.apiTokens = { tokens: {} }
    }
    
    const tokenId = generateTokenId()
    const token = generateApiToken()
    const now = new Date().toISOString()
    
    const tokenData = {
        id: tokenId,
        name,
        token,
        owner,
        permissions,
        type,
        createdAt: now,
        updatedAt: now,
        expiresAt: expiresAt ?? null,
        autoDelete: autoDelete === true
    }
    
    settings.apiTokens.tokens[tokenId] = tokenData
    
    // 保存到数据库
    await db.put('manage@sysConfig@security', JSON.stringify(settings))
    
    return {
        id: tokenId,
        name,
        token,
        owner,
        permissions,
        createdAt: now,
        updatedAt: now,
        expiresAt: tokenData.expiresAt,
        autoDelete: tokenData.autoDelete
    }
}

// 删除API Token
export async function deleteApiToken(db, tokenId) {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    
    if (!settings.apiTokens?.tokens?.[tokenId]) {
        return { error: 'Token 不存在' }
    }
    
    delete settings.apiTokens.tokens[tokenId]
    
    // 保存到数据库
    await db.put('manage@sysConfig@security', JSON.stringify(settings))
    
    return { success: true, message: 'Token 已删除' }
}

// 更新API Token
async function updateApiToken(db, tokenId, permissions, expiresAt = null, autoDelete = false) {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    
    if (!settings.apiTokens?.tokens?.[tokenId]) {
        return { error: 'Token 不存在' }
    }
    
    settings.apiTokens.tokens[tokenId].permissions = permissions
    settings.apiTokens.tokens[tokenId].updatedAt = new Date().toISOString()
    settings.apiTokens.tokens[tokenId].expiresAt = expiresAt ?? null
    settings.apiTokens.tokens[tokenId].autoDelete = autoDelete === true
    
    // 保存到数据库
    await db.put('manage@sysConfig@security', JSON.stringify(settings))
    
    return {
        success: true,
        message: 'Token 已更新',
        tokenId
    }
}

// 生成随机Token（使用密码学安全随机数）
function generateApiToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    return 'imgbed_' + hex;
}

// 生成Token ID（使用密码学安全随机数）
function generateTokenId() {
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 根据Token获取权限（供其他API使用）
export async function getTokenPermissions(db, token) {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    const tokens = settings.apiTokens?.tokens || {}
    
    // 查找匹配的token
    for (const tokenId in tokens) {
        if (tokens[tokenId].token === token) {
            return tokens[tokenId].permissions
        }
    }
    
    return null
}

// 根据Token获取完整数据对象（供tokenValidator使用）
export async function getTokenData(db, token) {
    const settingsStr = await db.get('manage@sysConfig@security')
    const settings = settingsStr ? JSON.parse(settingsStr) : {}
    const tokens = settings.apiTokens?.tokens || {}
    
    // 查找匹配的token
    for (const tokenId in tokens) {
        if (tokens[tokenId].token === token) {
            const t = tokens[tokenId]
            return {
                id: t.id,
                name: t.name,
                token: t.token,
                owner: t.owner,
                permissions: t.permissions,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                expiresAt: t.expiresAt ?? null,
                autoDelete: t.autoDelete ?? false
            }
        }
    }
    
    return null
}
