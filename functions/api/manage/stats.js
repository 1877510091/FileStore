import { readIndex } from '../../utils/indexManager.js';
import { resolveFileScope } from '../../utils/auth/currentUser.js';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
});

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    try {
        const scope = await resolveFileScope(context.env, request);
        const now = Date.now();
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const weekMs = weekStart.getTime();

        const result = await readIndex(context, {
            count: -1,
            scope,
        });

        let todayUploads = 0;
        let weekUploads = 0;
        let todaySize = 0;
        let weekSize = 0;

        if (result.success && result.files) {
            for (const f of result.files) {
                const ts = f.metadata?.TimeStamp || 0;
                const sz = f.metadata?.FileSizeBytes || 0;
                if (ts >= todayMs) { todayUploads++; todaySize += sz; }
                if (ts >= weekMs) { weekUploads++; weekSize += sz; }
            }
        }

        return json({
            code: 0,
            data: {
                todayUploads,
                weekUploads,
                todaySize,
                weekSize,
                totalFiles: result.totalCount || 0,
            }
        });
    } catch (error) {
        return json({ code: -1, message: error.message }, 500);
    }
}
