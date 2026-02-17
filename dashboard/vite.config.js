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
                // POST /api/realtime/token → creates ephemeral token
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
                        // Read body for model/voice/instructions
                        const body = await new Promise((resolve) => {
                            let data = '';
                            req.on('data', c => data += c);
                            req.on('end', () => {
                                try { resolve(JSON.parse(data)); }
                                catch { resolve({}); }
                            });
                        });

                        const reqBody = {
                            type: 'realtime',
                            model: body.model || 'gpt-realtime',
                            instructions: body.instructions || 'You are a helpful assistant.',
                            audio: {
                                output: {
                                    voice: body.voice || 'ash'
                                }
                            }
                        };

                        console.log('[Token Proxy] Creating GA client secret with voice:', reqBody.voice);

                        // GA endpoint: /v1/realtime/client_secrets
                        const tokenResp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                session: reqBody
                            }),
                        });

                        const result = await tokenResp.json();
                        console.log('[Token Proxy] Response status:', tokenResp.status);
                        res.setHeader('Content-Type', 'application/json');

                        if (!tokenResp.ok) {
                            const errorMsg = `[Token Proxy] OpenAI Error: ${tokenResp.status} ${JSON.stringify(result, null, 2)}`;
                            console.error(errorMsg);
                            try {
                                fs.appendFileSync(path.resolve(__dirname, 'proxy_error.log'), errorMsg + '\n---\n');
                            } catch (e) {
                                console.error('Failed to write to log file:', e);
                            }
                            res.statusCode = tokenResp.status;
                            res.end(JSON.stringify({ error: result.error?.message || 'Token creation failed' }));
                            return;
                        }

                        // GA endpoint returns { value: "ek_...", expires_at: ... } at top level
                        const token = result.value || result.client_secret?.value;
                        console.log('[Token Proxy] Token obtained:', token?.substring(0, 12) + '...');
                        res.statusCode = 200;
                        res.end(JSON.stringify({
                            token: token,
                            expires_at: result.expires_at,
                        }));
                    } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
            },
        },
    ],
});
