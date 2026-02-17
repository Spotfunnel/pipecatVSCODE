// ── Voice Test Widget ──────────────────────────────────────────
// Connects to OpenAI Realtime API via WebRTC for live voice testing.
// Flow: get ephemeral token → RTCPeerConnection → mic audio → AI responds
//
// GA model (gpt-realtime) — session fully configured at token creation time
// via /v1/realtime/client_secrets. No session.update needed.
//
// Function calling: if webhooks are configured, they are exposed as tools
// to the AI. When the AI triggers a tool, we fire the webhook via the
// /api/webhook/test proxy and show the result in the transcript.

export function renderVoiceTest(getSystemPrompt, getVoice, getWebhooks) {
    const el = document.createElement('div');
    el.className = 'voice-tester';

    let pc = null;         // RTCPeerConnection
    let dc = null;         // DataChannel
    let audioEl = null;    // Remote audio playback
    let localStream = null;
    let isActive = false;
    let sessionStartTime = null;
    let sessionTimer = null;

    // Map of tool name → webhook URL for runtime lookup
    let toolWebhookMap = {};

    el.innerHTML = `
    <p class="voice-tester-text">Test your agent's voice and personality in real-time</p>
    <button class="voice-btn" id="voiceTestBtn" title="Start voice test">🎙️</button>
    <div class="audio-visualizer" id="audioViz">
      ${Array.from({ length: 8 }, () => '<div class="audio-bar"></div>').join('')}
    </div>
    <p class="voice-status" id="voiceStatus">Click the microphone to start a test conversation</p>
    <div class="voice-transcript" id="voiceTranscript" style="display:none;">
      <div class="transcript-scroll" id="transcriptScroll"></div>
    </div>
  `;

    requestAnimationFrame(() => {
        const btn = el.querySelector('#voiceTestBtn');
        const viz = el.querySelector('#audioViz');
        const status = el.querySelector('#voiceStatus');
        const transcriptDiv = el.querySelector('#voiceTranscript');
        const transcriptScroll = el.querySelector('#transcriptScroll');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (isActive) {
                cleanup();
                setStatus('Test ended. Click to start again.', 'var(--text-tertiary)');
            } else {
                await startSession();
            }
        });

        function setStatus(text, color) {
            status.textContent = text;
            status.style.color = color || 'var(--text-tertiary)';
        }

        function appendTranscript(role, text) {
            const line = document.createElement('div');
            line.className = `transcript-line transcript-${role}`;
            const roleLabel = role === 'user' ? '🙂 You' : role === 'webhook' ? '🔗 Webhook' : '🤖 Agent';
            line.innerHTML = `<span class="transcript-role">${roleLabel}:</span> ${text}`;
            transcriptScroll.appendChild(line);
            transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
            transcriptDiv.style.display = 'block';
        }

        function formatDuration(ms) {
            const s = Math.floor(ms / 1000);
            return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        }

        function cleanup() {
            isActive = false;
            if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
            if (dc) { try { dc.close(); } catch { } dc = null; }
            if (pc) { try { pc.close(); } catch { } pc = null; }
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
                localStream = null;
            }
            if (audioEl) {
                audioEl.pause();
                audioEl.srcObject = null;
                try { audioEl.remove(); } catch { }
                audioEl = null;
            }
            btn.classList.remove('recording');
            btn.textContent = '🎙️';
            btn.disabled = false;
            viz.classList.remove('active');
            toolWebhookMap = {};
        }

        // ── Fire a webhook via server proxy ──────────────────
        async function fireWebhook(webhookUrl, args) {
            try {
                const resp = await fetch('/api/webhook/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: webhookUrl, payload: args }),
                });
                const result = await resp.json();
                return {
                    success: result.success,
                    status: result.status,
                    response: result.response,
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        async function startSession() {
            // Resolve current values from getter functions (onboarding passes closures)
            const systemPrompt = typeof getSystemPrompt === 'function' ? getSystemPrompt() : (getSystemPrompt || '');
            const selectedVoice = typeof getVoice === 'function' ? getVoice() : (getVoice || 'coral');
            const webhooks = typeof getWebhooks === 'function' ? getWebhooks() : (getWebhooks || []);
            const instructions = systemPrompt || 'You are a helpful voice AI assistant. Keep responses concise.';

            // Build tools from webhooks
            let tools = [];
            toolWebhookMap = {};

            if (webhooks && webhooks.length > 0) {
                // Dynamic import to avoid circular deps
                const { buildToolsFromWebhooks } = await import('./webhook-builder.js');
                tools = buildToolsFromWebhooks(webhooks);

                // Build lookup map: tool name → webhook URL
                tools.forEach(tool => {
                    toolWebhookMap[tool.name] = tool._webhookUrl;
                });

                console.log('[VoiceTest] Registered', tools.length, 'tools from webhooks:', Object.keys(toolWebhookMap));
            }

            try {
                setStatus('🔐 Connecting to OpenAI Realtime...', 'var(--accent-cyan)');
                btn.disabled = true;

                console.log('[VoiceTest] Voice:', selectedVoice, '| Prompt length:', instructions.length, '| Tools:', tools.length);

                // 1. Get ephemeral token — proxy configures EVERYTHING at creation:
                //    output_modalities, voice, instructions, turn_detection, tools
                setStatus('🔑 Getting session token...', 'var(--accent-cyan)');
                const tokenBody = {
                    model: 'gpt-realtime',
                    voice: selectedVoice,
                    instructions: instructions,
                };

                // Include tools if any webhooks are configured
                if (tools.length > 0) {
                    tokenBody.tools = tools;
                }

                const tokenResp = await fetch('/api/realtime/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(tokenBody),
                });

                const tokenData = await tokenResp.json();
                if (!tokenResp.ok) {
                    throw new Error(tokenData.error || `Token request failed (${tokenResp.status})`);
                }

                const ephemeralKey = tokenData.token;
                if (!ephemeralKey) {
                    throw new Error('No ephemeral token received');
                }
                console.log('[VoiceTest] Token received:', ephemeralKey.substring(0, 10) + '...');

                // 2. Get microphone permission first (user gesture required)
                setStatus('🎤 Requesting microphone access...', 'var(--accent-cyan)');
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (micErr) {
                    throw new Error('Microphone access denied. Please allow microphone access and try again.');
                }
                console.log('[VoiceTest] Microphone acquired, tracks:', localStream.getTracks().length);

                // 3. Create RTCPeerConnection
                pc = new RTCPeerConnection();

                pc.onconnectionstatechange = () => {
                    console.log('[VoiceTest] Connection state:', pc.connectionState);
                    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                        appendTranscript('agent', '⚠️ Connection lost');
                        cleanup();
                        setStatus('❌ Connection lost. Click to reconnect.', 'var(--accent-rose)');
                    }
                };

                pc.oniceconnectionstatechange = () => {
                    console.log('[VoiceTest] ICE state:', pc.iceConnectionState);
                };

                // 4. Set up remote audio playback (AI voice output)
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                document.body.appendChild(audioEl);
                pc.ontrack = (e) => {
                    console.log('[VoiceTest] ★ Got remote audio track');
                    audioEl.srcObject = e.streams[0];
                };

                // 5. Add local audio track
                pc.addTrack(localStream.getTracks()[0]);

                // 6. Create data channel for events
                dc = pc.createDataChannel('oai-events');

                let currentAssistantText = '';

                dc.onopen = () => {
                    // GA model: session is 100% configured at creation time via client_secrets.
                    // NO session.update needed — GA rejects many beta-style params (voice, modalities)
                    // which caused "Unknown parameter" errors → response failures.
                    console.log('[VoiceTest] Session ready — no session.update needed (configured at creation)');

                    if (tools.length > 0) {
                        console.log('[VoiceTest] Function calling enabled with', tools.length, 'tools');
                    }

                    // Start session timer
                    sessionStartTime = Date.now();
                    sessionTimer = setInterval(() => {
                        if (isActive) {
                            const elapsed = formatDuration(Date.now() - sessionStartTime);
                            const currentStatus = status.textContent;
                            if (currentStatus.includes('Your turn') || currentStatus.includes('Connected')) {
                                setStatus(`🎙️ Your turn — speak to your agent (${elapsed})`, 'var(--accent-green)');
                            }
                        }
                    }, 1000);
                };

                dc.onclose = () => {
                    const duration = sessionStartTime ? formatDuration(Date.now() - sessionStartTime) : 'unknown';
                    console.log('[VoiceTest] Data channel closed after', duration);
                    if (isActive) {
                        cleanup();
                        setStatus('⚠️ Session ended by server. Click to restart.', 'var(--accent-rose)');
                    }
                };

                dc.onerror = (e) => {
                    console.error('[VoiceTest] Data channel error:', e);
                };

                dc.onmessage = async (e) => {
                    try {
                        const event = JSON.parse(e.data);
                        // Log all events (skip noisy audio.delta)
                        if (event.type !== 'response.audio.delta') {
                            console.log('[VoiceTest] Event:', event.type);
                        }

                        switch (event.type) {
                            case 'session.created':
                                console.log('[VoiceTest] Session created:', event.session?.id);
                                console.log('[VoiceTest] output_modalities:', event.session?.output_modalities);
                                console.log('[VoiceTest] voice:', event.session?.audio?.output?.voice);
                                console.log('[VoiceTest] tools:', event.session?.tools?.length || 0);
                                break;

                            case 'session.updated':
                                console.log('[VoiceTest] ✓ Session updated successfully');
                                break;

                            case 'response.audio_transcript.delta':
                                currentAssistantText += event.delta || '';
                                break;

                            case 'response.audio_transcript.done':
                                if (currentAssistantText) {
                                    appendTranscript('agent', currentAssistantText);
                                }
                                currentAssistantText = '';
                                break;

                            case 'conversation.item.input_audio_transcription.completed':
                                if (event.transcript) {
                                    appendTranscript('user', event.transcript);
                                }
                                break;

                            case 'input_audio_buffer.speech_started':
                                setStatus('🔴 Listening...', 'var(--accent-rose)');
                                break;

                            case 'input_audio_buffer.speech_stopped':
                                setStatus('🧠 Thinking...', 'var(--accent-cyan)');
                                break;

                            case 'response.audio.delta':
                                setStatus('🔊 Agent speaking...', 'var(--accent-purple)');
                                break;

                            // ── Function Calling Events ──────────────
                            case 'response.function_call_arguments.done': {
                                const toolName = event.name;
                                const callId = event.call_id;
                                let args = {};

                                try {
                                    args = JSON.parse(event.arguments || '{}');
                                } catch {
                                    args = {};
                                }

                                console.log('[VoiceTest] Function call:', toolName, args);
                                setStatus('🔗 Firing webhook...', 'var(--accent-emerald)');
                                appendTranscript('webhook', `🚀 Calling <b>${toolName}</b>...`);

                                // Look up the webhook URL
                                const webhookUrl = toolWebhookMap[toolName];
                                let toolResult;

                                if (webhookUrl) {
                                    const webhookResult = await fireWebhook(webhookUrl, args);
                                    if (webhookResult.success) {
                                        appendTranscript('webhook', `✅ <b>${toolName}</b> succeeded (HTTP ${webhookResult.status})`);
                                        toolResult = JSON.stringify({ success: true, message: 'Webhook delivered successfully' });
                                    } else {
                                        appendTranscript('webhook', `❌ <b>${toolName}</b> failed: ${webhookResult.error || 'HTTP ' + webhookResult.status}`);
                                        toolResult = JSON.stringify({ success: false, error: webhookResult.error || 'Webhook failed' });
                                    }
                                } else {
                                    appendTranscript('webhook', `⚠️ No webhook URL configured for <b>${toolName}</b>`);
                                    toolResult = JSON.stringify({ success: false, error: 'No webhook URL configured' });
                                }

                                // Send tool result back to the AI so it can continue
                                if (dc && dc.readyState === 'open') {
                                    // 1. Send function call output
                                    dc.send(JSON.stringify({
                                        type: 'conversation.item.create',
                                        item: {
                                            type: 'function_call_output',
                                            call_id: callId,
                                            output: toolResult,
                                        },
                                    }));

                                    // 2. Ask AI to respond
                                    dc.send(JSON.stringify({
                                        type: 'response.create',
                                    }));
                                }

                                setStatus('🎙️ Your turn — speak to your agent', 'var(--accent-green)');
                                break;
                            }

                            case 'response.done':
                                // Log full details to diagnose failures
                                console.log('[VoiceTest] Response done — status:', event.response?.status);
                                if (event.response?.status === 'failed') {
                                    console.error('[VoiceTest] RESPONSE FAILED:', JSON.stringify(event.response?.status_details || event.response, null, 2));
                                    appendTranscript('agent', `⚠️ Response failed: ${event.response?.status_details?.error?.message || 'unknown reason'}`);
                                }
                                setStatus('🎙️ Your turn — speak to your agent', 'var(--accent-green)');
                                break;

                            case 'error':
                                console.error('[VoiceTest] API error:', JSON.stringify(event.error, null, 2));
                                appendTranscript('agent', `⚠️ Error: ${event.error?.message || JSON.stringify(event.error)}`);
                                break;
                        }
                    } catch (err) {
                        console.error('[VoiceTest] Parse error:', err);
                    }
                };

                // 7. SDP offer/answer exchange
                setStatus('📡 Establishing WebRTC connection...', 'var(--accent-cyan)');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log('[VoiceTest] SDP offer created, type:', offer.type);

                const sdpResp = await fetch('https://api.openai.com/v1/realtime/calls', {
                    method: 'POST',
                    body: offer.sdp,
                    headers: {
                        'Authorization': `Bearer ${ephemeralKey}`,
                        'Content-Type': 'application/sdp',
                    },
                });

                if (!sdpResp.ok) {
                    const errText = await sdpResp.text();
                    console.error('[VoiceTest] SDP response error:', sdpResp.status, errText);
                    throw new Error(`WebRTC setup failed (${sdpResp.status}): ${errText.substring(0, 200)}`);
                }

                const answerSdp = await sdpResp.text();
                console.log('[VoiceTest] SDP answer received, length:', answerSdp.length);

                await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
                console.log('[VoiceTest] Remote description set — connection establishing');

                // Connected!
                isActive = true;
                btn.disabled = false;
                btn.classList.add('recording');
                btn.textContent = '⏹️';
                viz.classList.add('active');
                const toolCount = tools.length;
                setStatus(`🎙️ Connected — speak to your agent${toolCount > 0 ? ` (${toolCount} webhook${toolCount > 1 ? 's' : ''} active)` : ''}`, 'var(--accent-green)');
                transcriptScroll.innerHTML = '';
                transcriptDiv.style.display = 'block';

            } catch (err) {
                console.error('[VoiceTest] Connection error:', err);
                cleanup();
                setStatus(`❌ ${err.message}`, 'var(--accent-rose)');
            }
        }
    });

    return el;
}
