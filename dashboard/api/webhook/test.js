export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { url, payload } = req.body || {};

        if (!url) {
            return res.status(400).json({ error: 'Missing webhook URL' });
        }

        const webhookResp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const statusCode = webhookResp.status;
        let responseBody;
        try {
            responseBody = await webhookResp.text();
        } catch {
            responseBody = '';
        }

        return res.status(200).json({
            success: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            response: responseBody.substring(0, 500),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message, success: false });
    }
}
