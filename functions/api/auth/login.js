import { fetchSecurityConfig } from "../../utils/sysConfig.js";
import { verifyPassword, rehashIfNeeded } from "../../utils/auth/passwordHash.js";
import { createSession } from "../../utils/auth/sessionManager.js";
import { getDatabase } from "../../utils/databaseAdapter.js";
import { logActivity } from "../../utils/activityLog.js";
import { checkRateLimit, clearRateLimit } from "../../utils/rateLimiter.js";

/**
 * 网盘页登录：只认用户名，不校验密码。
 * 密码只在管理后台（/api/auth/adminLogin）校验。
 * 登录成功后签发独立的 user_session，与 admin_session 互不影响。
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();

    const ip = request.headers.get('cf-connecting-ip') || '';

    // 速率限制检查
    const rl = await checkRateLimit(env, ip, 'login');
    if (rl.limited) {
        return new Response(JSON.stringify({ code: -1, message: `尝试次数过多，请等待 ${rl.retryAfter} 秒后重试` }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) },
        });
    }

    // authCode 兼容旧客户端
    const username = (body.username || body.authCode || '').trim();
    if (!username) return unauthorized('请输入用户名');

    const db = env.img_d1;

    // 1. 多用户表：按用户名定位身份
    if (db && typeof db.prepare === 'function') {
        const usersTable = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();

        if (usersTable) {
            const user = await db
                .prepare("SELECT id, username, display_name, avatar, role, status FROM users WHERE username = ? AND status = 'active'")
                .bind(username)
                .first();

            if (!user) return unauthorized('用户不存在，请联系管理员开通');

            const { cookie } = await createSession(env, 'user');
            const sessionData = {
                userId: user.id,
                username: user.username,
                displayName: user.display_name || user.username,
                avatar: user.avatar || '',
                role: user.role || 'user',
            };
            const sessionKey = cookie.match(/user_session=([^;]+)/);
            if (sessionKey) {
                await db
                    .prepare('INSERT OR REPLACE INTO other_data (key, value, type) VALUES (?, ?, ?)')
                    .bind('manage@session@user_' + sessionKey[1], JSON.stringify(sessionData), 'session')
                    .run();
            }

            await logActivity(env, { userId: user.id, action: 'login', details: '网盘登录', ip });
            await clearRateLimit(env, ip, 'login');

            return new Response(JSON.stringify({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name || user.username,
                    avatar: user.avatar || '',
                    role: user.role || 'user',
                }
            }), {
                status: 200,
                headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
            });
        }
    }

    // 2. 未建用户表时，退回旧版全局 authCode 模式
    const securityConfig = await fetchSecurityConfig(env, { throwOnError: true });
    const rightAuthCode = securityConfig.auth.user.authCode;
    if (!rightAuthCode) return unauthorized('用户不存在，请联系管理员开通');

    const isValid = await verifyPassword(username, rightAuthCode);
    if (!isValid) return unauthorized('用户名或密码错误');

    const adapter = getDatabase(env);
    await rehashIfNeeded(adapter, username, rightAuthCode, 'auth.user.authCode');
    const { cookie } = await createSession(env, 'user');
    await clearRateLimit(env, ip, 'login');
    return new Response('Login success', { status: 200, headers: { 'Set-Cookie': cookie } });
}

function unauthorized(message) {
    return new Response(JSON.stringify({ code: -1, message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
    });
}
