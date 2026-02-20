// ── POST /api/recall/stop ────────────────────────────────────
// Tells the Recall.ai bot to leave the call.

import { createClient } from '@supabase/supabase-js';

const RECALL_REGION = 'ap-northeast-1';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const RECALL_API_KEY = process.env.RECALL_API_KEY;
    if (!RECALL_API_KEY) {
        return res.status(500).json({ error: 'RECALL_API_KEY not configured' });
    }

    const { botId } = req.body || {};
    if (!botId) {
        return res.status(400).json({ error: 'Missing botId' });
    }

    try {
        const resp = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/leave_call/`, {
            method: 'POST',
            headers: { 'Authorization': `Token ${RECALL_API_KEY}` },
        });

        // Update session status in Supabase
        const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://kpvyguhkyotkfrwtcdtg.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY;
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        await supabase.from('demo_sessions')
            .update({ status: 'ended' })
            .eq('bot_id', botId);

        console.log('[recall/stop] Bot leaving call:', botId);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[recall/stop] Error:', err);
        return res.status(500).json({ error: err.message });
    }
}
