/**
 * 登录速率限制器
 * 使用 D1 持久化存储，支持可配置的最大尝试次数和时间窗口
 */
import { getDatabase } from './databaseAdapter.js';
import { fetchSecurityConfig } from './sysConfig.js';

const CLEANUP_INTERVAL = 3600000; // 1小时清理一次过期记录

/**
 * 检查是否超出速率限制
 * @returns {{ limited: boolean, retryAfter?: number, remaining?: number }}
 */
export async function checkRateLimit(env, ip, endpoint = 'login') {
    const securityConfig = await fetchSecurityConfig(env);
    const rl = securityConfig.rateLimit || {};
    const enabled = rl.enabled ?? true;
    const maxAttempts = rl.maxAttempts || 5;
    const windowSeconds = rl.windowSeconds || 60;

    if (!enabled) return { limited: false };

    const db = getDatabase(env);
    if (!db || typeof db.prepare !== 'function') return { limited: false };

    // 确保表存在
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                ip TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                attempts INTEGER DEFAULT 1,
                window_start INTEGER NOT NULL,
                PRIMARY KEY (ip, endpoint)
            )
        `).run();
    } catch (e) {
        // 表可能已存在，忽略
    }

    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // 读取当前记录
    const record = await db.prepare(
        'SELECT attempts, window_start FROM rate_limits WHERE ip = ? AND endpoint = ?'
    ).bind(ip, endpoint).first();

    if (record) {
        const elapsed = now - record.window_start;

        if (elapsed < windowMs) {
            // 还在窗口内
            if (record.attempts >= maxAttempts) {
                const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
                return { limited: true, retryAfter, remaining: 0 };
            }
            // 未超限，增加计数
            await db.prepare(
                'UPDATE rate_limits SET attempts = attempts + 1 WHERE ip = ? AND endpoint = ?'
            ).bind(ip, endpoint).run();
            return { limited: false, remaining: maxAttempts - record.attempts - 1 };
        } else {
            // 窗口已过期，重置
            await db.prepare(
                'UPDATE rate_limits SET attempts = 1, window_start = ? WHERE ip = ? AND endpoint = ?'
            ).bind(now, ip, endpoint).run();
            return { limited: false, remaining: maxAttempts - 1 };
        }
    } else {
        // 首次尝试
        await db.prepare(
            'INSERT INTO rate_limits (ip, endpoint, attempts, window_start) VALUES (?, ?, 1, ?)'
        ).bind(ip, endpoint, now).run();
        return { limited: false, remaining: maxAttempts - 1 };
    }
}

/**
 * 登录失败时记录一次尝试
 */
export async function recordFailedAttempt(env, ip, endpoint = 'login') {
    // checkRateLimit 已经在每次调用时自增计数，所以失败时不需要额外操作
    // 但如果要区分"检查"和"记录失败"，可以在这里处理
}

/**
 * 登录成功时清除该 IP 的速率限制记录
 */
export async function clearRateLimit(env, ip, endpoint = 'login') {
    const db = getDatabase(env);
    if (!db || typeof db.prepare !== 'function') return;
    try {
        await db.prepare('DELETE FROM rate_limits WHERE ip = ? AND endpoint = ?')
            .bind(ip, endpoint).run();
    } catch (e) {}
}
