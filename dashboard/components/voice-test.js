// ── Voice Test Widget ─────────────────────────────────────
// Connects to OpenAI Realtime API via WebRTC for live voice testing.
// Flow: get ephemeral token → RTCPeerConnection → mic audio → AI responds

// getSystemPrompt: function that returns the current system prompt string
export function renderVoiceTest(getSystemPrompt) {
    const el = document.createElement('div');
    el.className = 'voice-tester';

    let pc = null;         // RTCPeerConnection
    let dc = null;         // DataChannel
    let audioEl = null;    // Remote audio playback
    let localStream = null;
    let isActive = false;

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
            line.innerHTML = `<span class="transcript-role">${role === 'user' ? '🎤 You' : '🤖 Agent'}:</span> ${text}`;
            transcriptScroll.appendChild(line);
            transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
            transcriptDiv.style.display = 'block';
        }

        function cleanup() {
            isActive = false;
            if (dc) { try { dc.close(); } catch { } dc = null; }
            if (pc) { try { pc.close(); } catch { } pc = null; }
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
                localStream = null;
            }
            if (audioEl) {
                audioEl.srcObject = null;
                audioEl = null;
            }
            btn.classList.remove('recording');
            btn.textContent = '🎙️';
            btn.disabled = false;
            viz.classList.remove('active');
        }

        async function startSession() {
            try {
                setStatus('🔄 Connecting to OpenAI Realtime...', 'var(--accent-cyan)');
                btn.disabled = true;

                // 1. Get ephemeral token
                setStatus('🔑 Getting session token...', 'var(--accent-cyan)');
                const tokenResp = await fetch('/api/realtime/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'gpt-realtime',
                        voice: 'ash',
                        instructions: systemPrompt || 'You are a helpful voice AI assistant. Keep responses concise.',
                    }),
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
                console.log('[VoiceTest] Microphone acquired');

                // 3. Create RTCPeerConnection
                pc = new RTCPeerConnection();

                // Monitor connection state
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
                document.body.appendChild(audioEl); // Must be in DOM for some browsers
                pc.ontrack = (e) => {
                    console.log('[VoiceTest] Got remote audio track');
                    audioEl.srcObject = e.streams[0];
                };

                // 5. Add local audio track
                pc.addTrack(localStream.getTracks()[0]);

                // 6. Create data channel for events
                dc = pc.createDataChannel('oai-events');

                let currentAssistantText = '';

                dc.onopen = () => {
                    // Read system prompt FRESH at connection time (not stale from render time)
                    const currentPrompt = typeof getSystemPrompt === 'function' ? getSystemPrompt() : (getSystemPrompt || '');
                    const instructions = currentPrompt || 'You are a helpful voice AI assistant. Keep responses concise. Always respond in English only.';
                    console.log('[VoiceTest] Data channel open — sending session config');
                    console.log('[VoiceTest] Instructions:', instructions.substring(0, 100) + '...');
                    // GA API session.update only supports: type, instructions, tools, tool_choice
                    // Voice, model, turn_detection etc. are configured at session creation, not update
                    dc.send(JSON.stringify({
                        type: 'session.update',
                        session: {
                            type: 'realtime',
                            instructions: instructions,
                        },
                    }));
                    console.log('[VoiceTest] session.update sent');
                };

                dc.onclose = () => {
                    console.log('[VoiceTest] Data channel closed');
                    if (isActive) {
                        cleanup();
                        setStatus('⚠️ Session ended by server. Click to restart.', 'var(--accent-rose)');
                    }
                };

                dc.onerror = (e) => {
                    console.error('[VoiceTest] Data channel error:', e);
                };

                dc.onmessage = (e) => {
                    try {
                        const event = JSON.parse(e.data);
                        // Log all events for debugging
                        if (event.type !== 'response.audio.delta') {
                            console.log('[VoiceTest] Event:', event.type);
                        }

                        switch (event.type) {
                            case 'session.created':
                                console.log('[VoiceTest] Session created:', event.session?.id);
                                break;

                            case 'session.updated':
                                console.log('[VoiceTest] Session updated');
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
                                setStatus('🤔 Thinking...', 'var(--accent-cyan)');
                                break;

                            case 'response.audio.delta':
                                setStatus('🔊 Agent speaking...', 'var(--accent-purple)');
                                break;

                            case 'response.done':
                                setStatus('🎙️ Your turn — speak to your agent', 'var(--accent-green)');
                                break;

                            case 'error':
                                console.error('[VoiceTest] API error:', event.error);
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
                console.log('[VoiceTest] SDP offer created');

                const sdpResp = await fetch('https://api.openai.com/v1/realtime/calls?model=gpt-realtime', {
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
                setStatus('🎙️ Connected — speak to your agent', 'var(--accent-green)');
                transcriptScroll.innerHTML = '';
                transcriptDiv.style.display = 'block';

            } catch (err) {
                console.error('[VoiceTest] Connection error:', err);
                cleanup();
                // Show error AFTER cleanup (don't let cleanup overwrite it)
                setStatus(`❌ ${err.message}`, 'var(--accent-rose)');
            }
        }
    });

    return el;
}
