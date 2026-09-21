export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.img_d1;

    if (request.method === 'DELETE') {
        try {
            await db.prepare('DELETE FROM file_shares WHERE id = ?').bind(params.id).run();
            return new Response(JSON.stringify({ code: 0, message: '分享已取消' }), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify({ code: -1, message: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }
    return new Response('Method not allowed', { status: 405 });
}
