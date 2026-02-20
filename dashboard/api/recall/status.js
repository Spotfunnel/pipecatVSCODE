// ── GET /api/recall/status ───────────────────────────────────
// Proxies bot status from Recall.ai API.

const RECALL_REGION = 'ap-northeast-1';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const RECALL_API_KEY = process.env.RECALL_API_KEY;
    if (!RECALL_API_KEY) {
        return res.status(500).json({ error: 'RECALL_API_KEY not configured' });
    }

    const botId = req.query.botId;
    if (!botId) {
        return res.status(400).json({ error: 'Missing botId query parameter' });
    }

    try {
        const resp = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/`, {
            headers: { 'Authorization': `Token ${RECALL_API_KEY}` },
        });

        const data = await resp.json();

        if (!resp.ok) {
            return res.status(resp.status).json({
                error: data.detail || 'Failed to get bot status',
            });
        }

        // Extract the latest status from status_changes array
        const latestStatus = data.status_changes?.length > 0
            ? data.status_changes[data.status_changes.length - 1]
            : null;

        return res.status(200).json({
            status: latestStatus?.code || data.status || 'unknown',
            statusMessage: latestStatus?.message || '',
            botName: data.bot_name,
            meetingUrl: data.meeting_url,
        });
    } catch (err) {
        console.error('[recall/status] Error:', err);
        return res.status(500).json({ error: err.message });
    }
}
