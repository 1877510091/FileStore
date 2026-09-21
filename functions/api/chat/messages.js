/**
 * 私聊消息 API
 * GET : 拉取与某好友的会话，或拉取全部会话
 * POST: 发送文本 / 文件分享消息
 */
import { getSessionUser } from '../../utils/auth/currentUser.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.img_d1;

    const me = await getSessionUser(env, request);
    if (!me) return json({ code: -1, message: '未登录' }, 401);

    const url = new URL(request.url);

    if (request.method === 'GET') {
        const friendId = url.searchParams.get('friendId');
        const sinceId = parseInt(url.searchParams.get('sinceId') || '0', 10);

        let rows;
        if (friendId) {
            rows = await db
                .prepare(`SELECT m.*, s.username AS sender_name, s.display_name AS sender_display, s.avatar AS sender_avatar, fs.file_id AS shared_file_id
                          FROM chat_messages m
                          JOIN users s ON m.sender_id = s.id
                          LEFT JOIN file_shares fs ON m.file_share_id = fs.id
                          WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
                            AND m.id > ?
                          ORDER BY m.id ASC LIMIT 200`)
                .bind(me.id, friendId, friendId, me.id, sinceId)
                .all();
        } else {
            rows = await db
                .prepare(`SELECT m.*, s.username AS sender_name, s.display_name AS sender_display, s.avatar AS sender_avatar, fs.file_id AS shared_file_id
                          FROM chat_messages m
                          JOIN users s ON m.sender_id = s.id
                          LEFT JOIN file_shares fs ON m.file_share_id = fs.id
                          WHERE m.sender_id = ? OR m.receiver_id = ?
                          ORDER BY m.id DESC LIMIT 100`)
                .bind(me.id, me.id)
                .all();
        }

        // 标记对方发给我的消息为已读
        if (friendId) {
            await db
                .prepare('UPDATE chat_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0')
                .bind(friendId, me.id)
                .run();
        }

        return json({
            code: 0,
            data: {
                messages: (rows.results || []).map(m => ({
                    id: m.id,
                    senderId: m.sender_id,
                    receiverId: m.receiver_id,
                    senderName: m.sender_name,
                    senderDisplay: m.sender_display || '',
                    senderAvatar: m.sender_avatar || '',
                    message: m.message || '',
                    fileShareId: m.file_share_id || '',
                    fileId: m.shared_file_id || '',
                    messageType: m.message_type || 'text',
                    isRead: !!m.is_read,
                    createdAt: m.created_at,
                }))
            }
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const { receiverId, message, fileShareId, messageType } = body;
        if (!receiverId) return json({ code: -1, message: '缺少接收者ID' }, 400);

        await db
            .prepare('INSERT INTO chat_messages (sender_id, receiver_id, message, file_share_id, message_type) VALUES (?, ?, ?, ?, ?)')
            .bind(me.id, receiverId, message || '', fileShareId || '', messageType || 'text')
            .run();

        return json({ code: 0, message: '消息发送成功' });
    }

    return json({ code: -1, message: 'Method not allowed' }, 405);
}

function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}
