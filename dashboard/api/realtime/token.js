export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    try {
        const body = req.body || {};

        // GA client_secrets schema — configure EVERYTHING at creation time
        const reqBody = {
            session: {
                type: 'realtime',
                model: body.model || 'gpt-realtime',
                instructions: body.instructions || 'You are a helpful assistant.',
                audio: {
                    input: {
                        transcription: { model: 'gpt-4o-mini-transcribe' },
                        turn_detection: {
                            type: 'server_vad',
                            threshold: 0.5,
                            prefix_padding_ms: 300,
                            silence_duration_ms: 500,
                        },
                    },
                    output: {
                        voice: body.voice || 'ash',
                    },
                },
            },
        };

        // Add tools (function calling) if provided
        if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
            reqBody.session.tools = body.tools.map(tool => {
                const { _webhookUrl, _webhookId, ...cleanTool } = tool;
                return cleanTool;
            });
        }

        const tokenResp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(reqBody),
        });

        const result = await tokenResp.json();

        if (!tokenResp.ok) {
            return res.status(tokenResp.status).json({
                error: result.error?.message || 'Token creation failed',
            });
        }

        const token = result.value || result.client_secret?.value;
        return res.status(200).json({
            token: token,
            expires_at: result.expires_at,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
