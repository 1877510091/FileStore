import { validateAnySession } from "../../utils/auth/sessionManager.js";
import { fetchSecurityConfig } from "../../utils/sysConfig.js";

export async function onRequestGet(context) {
    const { request, env } = context;
    const db = env.img_d1;

    let securityConfig;
    try { securityConfig = await fetchSecurityConfig(env, { throwOnError: true }); }
    catch (error) { return new Response(JSON.stringify({ error: 'Security config unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }

    const adminUsername = securityConfig.auth.admin.adminUsername;
    const adminPassword = securityConfig.auth.admin.adminPassword;
    const userAuthCode = securityConfig.auth.user.authCode;
    const adminRequired = !!(adminUsername && adminUsername.trim()) || !!(adminPassword && adminPassword.trim());
    const userRequired = !!(userAuthCode && userAuthCode.trim());

    const sessionResult = await validateAnySession(env, request);
    if (sessionResult.valid) {
        const resp = { valid: true, authType: sessionResult.session.authType, adminRequired, userRequired };

        if (sessionResult.session.authType === 'user' && db && typeof db.prepare === 'function') {
            try {
                const sessionToken = request.headers.get('Cookie')?.match(/user_session=([^;]+)/)?.[1];
                if (sessionToken) {
                    const sessionData = await db.prepare('SELECT value FROM other_data WHERE key = ?').bind('manage@session@user_' + sessionToken).first();
                    if (sessionData) {
                        const userData = JSON.parse(sessionData.value);
                        // 被禁用或已删除的账号：会话立即失效（实时踢下线的兜底校验）
                        const urow = await db.prepare('SELECT status FROM users WHERE id = ?').bind(userData.userId).first();
                        if (!urow || ((urow.status || 'active') !== 'active')) {
                            return new Response(JSON.stringify({ valid: false, adminRequired, userRequired }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                        }
                        resp.user = { id: userData.userId, username: userData.username, displayName: userData.displayName || userData.username, avatar: userData.avatar || '', role: userData.role || 'user' };
                    }
                }
            } catch (e) {}
        }

        if (sessionResult.session.authType === 'admin') {
            resp.user = { id: 'admin', username: 'admin', displayName: '管理员', avatar: '', role: 'admin' };
        }

        return new Response(JSON.stringify(resp), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ valid: false, adminRequired, userRequired }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
