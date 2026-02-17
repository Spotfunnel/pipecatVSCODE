import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load OPENAI_API_KEY from parent .env
function loadApiKey() {
    const envPath = path.resolve(__dirname, '..', '.env');
    try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^OPENAI_API_KEY=(.+)$/m);
        return match ? match[1].trim() : null;
    } catch { return null; }
}

export default defineConfig({
    server: {
        port: 3000,
        open: true,
    },
    build: {
        outDir: 'dist',
    },
    plugins: [
        {
            name: 'openai-token-proxy',
            configureServer(server) {
                // POST /api/realtime/token → creates GA ephemeral token
                // MUST use /v1/realtime/client_secrets (GA endpoint)
                // /v1/realtime/sessions is BETA and tokens from it cannot be used with /v1/realtime/calls
                server.middlewares.use('/api/realtime/token', async (req, res) => {
                    if (req.method !== 'POST') {
                        res.statusCode = 405;
                        res.end(JSON.stringify({ error: 'Method not allowed' }));
                        return;
                    }

                    const apiKey = loadApiKey();
                    if (!apiKey) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not found in ../.env' }));
                        return;
                    }

                    try {
                        const body = await new Promise((resolve) => {
                            let data = '';
                            req.on('data', c => data += c);
                            req.on('end', () => {
                                try { resolve(JSON.parse(data)); }
                                catch { resolve({}); }
                            });
                        });

                        // GA client_secrets schema — configure EVERYTHING at creation time
                        // so no session.update is needed (GA rejects many beta-style params)
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
                                        voice: body.voice || 'ash'
                                    },
                                },
                            }
                        };

                        // Add tools (function calling) if provided
                        if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
                            // Strip our internal _webhookUrl / _webhookId before sending to OpenAI
                            reqBody.session.tools = body.tools.map(tool => {
                                const { _webhookUrl, _webhookId, ...cleanTool } = tool;
                                return cleanTool;
                            });
                            console.log('[Token Proxy] Including', reqBody.session.tools.length, 'tools in session config');
                        }

                        console.log('[Token Proxy] Creating GA client secret — model:', reqBody.session.model, 'voice:', reqBody.session.audio.output.voice);

                        const tokenResp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(reqBody),
                        });

                        const result = await tokenResp.json();
                        console.log('[Token Proxy] Response status:', tokenResp.status);
                        res.setHeader('Content-Type', 'application/json');

                        if (!tokenResp.ok) {
                            console.error('[Token Proxy] Error:', JSON.stringify(result, null, 2));
                            res.statusCode = tokenResp.status;
                            res.end(JSON.stringify({ error: result.error?.message || 'Token creation failed' }));
                            return;
                        }

                        // GA client_secrets returns { value: "ek_...", expires_at: ... } at top level
                        const token = result.value || result.client_secret?.value;
                        console.log('[Token Proxy] Token obtained:', token?.substring(0, 12) + '...');
                        res.statusCode = 200;
                        res.end(JSON.stringify({
                            token: token,
                            expires_at: result.expires_at,
                        }));
                    } catch (err) {
                        console.error('[Token Proxy] Error:', err);
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });

                // ── POST /api/webhook/test — proxy webhook test requests ───
                // Browser POSTs { url, payload } → we forward payload to url
                // This avoids CORS issues when the browser calls n8n directly
                server.middlewares.use('/api/webhook/test', async (req, res) => {
                    if (req.method !== 'POST') {
                        res.statusCode = 405;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'Method not allowed' }));
                        return;
                    }

                    try {
                        const body = await new Promise((resolve) => {
                            let data = '';
                            req.on('data', c => data += c);
                            req.on('end', () => {
                                try { resolve(JSON.parse(data)); }
                                catch { resolve({}); }
                            });
                        });

                        const { url, payload } = body;

                        if (!url) {
                            res.statusCode = 400;
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ error: 'Missing webhook URL' }));
                            return;
                        }

                        console.log(`[Webhook Test] Sending test payload to: ${url}`);
                        console.log(`[Webhook Test] Payload:`, JSON.stringify(payload, null, 2));

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

                        console.log(`[Webhook Test] Response: ${statusCode}`);

                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                            success: statusCode >= 200 && statusCode < 300,
                            status: statusCode,
                            response: responseBody.substring(0, 500),
                        }));
                    } catch (err) {
                        console.error('[Webhook Test] Error:', err);
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: err.message, success: false }));
                    }
                });
            },
        },
    ],
});
