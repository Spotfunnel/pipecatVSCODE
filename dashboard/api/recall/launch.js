// ── POST /api/recall/launch ──────────────────────────────────
// Saves demo session config to Supabase, creates a Recall.ai bot
// that joins a Google Meet with Output Media pointing to our meet-agent page.

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

    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://kpvyguhkyotkfrwtcdtg.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY;

    try {
        const { meetUrl, systemPrompt, voice, tools } = req.body || {};

        if (!meetUrl) {
            return res.status(400).json({ error: 'Missing meetUrl' });
        }

        // 1. Save session config to Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        const sessionConfig = {
            systemPrompt: systemPrompt || 'You are a helpful assistant.',
            voice: voice || 'coral',
            tools: (tools || []).map(t => {
                const { _webhookUrl, _webhookId, ...clean } = t;
                return clean;
            }),
        };

        const { data: session, error: dbError } = await supabase
            .from('demo_sessions')
            .insert({ config: sessionConfig, meet_url: meetUrl, status: 'creating' })
            .select()
            .single();

        if (dbError) {
            console.error('[recall/launch] DB error:', dbError.message);
            return res.status(500).json({ error: 'Failed to create session: ' + dbError.message });
        }

        // 2. Build the meet-agent page URL
        // Always use production custom domain — VERCEL_URL points to .vercel.app
        // which requires Vercel Authentication and blocks Recall.ai's headless Chrome
        const baseUrl = 'https://newspotfunnel.com';
        const agentPageUrl = `${baseUrl}/meet-agent.html?sessionId=${session.id}`;

        console.log('[recall/launch] Agent page URL:', agentPageUrl);

        // 3. Create Recall.ai bot
        const recallResp = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${RECALL_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                meeting_url: meetUrl,
                bot_name: 'Roxby',
                bot_image: `${baseUrl}/logo.svg`,
                output_media: {
                    camera: {
                        kind: 'webpage',
                        config: { url: agentPageUrl },
                    },
                },
                // Use 4-core variant for real-time WebRTC + OpenAI processing
                variant: {
                    google_meet: 'web_4_core',
                },
                recording_config: {
                    include_bot_in_recording: { audio: true },
                },
            }),
        });

        const recallData = await recallResp.json();

        if (!recallResp.ok) {
            console.error('[recall/launch] Recall.ai error:', JSON.stringify(recallData));
            await supabase.from('demo_sessions').update({ status: 'failed' }).eq('id', session.id);
            return res.status(recallResp.status).json({
                error: recallData.detail || recallData.message || 'Recall.ai bot creation failed',
            });
        }

        // 4. Update session with bot_id
        await supabase.from('demo_sessions')
            .update({ bot_id: recallData.id, status: 'joining' })
            .eq('id', session.id);

        console.log('[recall/launch] Bot created:', recallData.id, 'for session:', session.id);

        return res.status(200).json({
            success: true,
            botId: recallData.id,
            sessionId: session.id,
        });

    } catch (err) {
        console.error('[recall/launch] Error:', err);
        return res.status(500).json({ error: err.message });
    }
}
