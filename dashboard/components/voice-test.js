// ── Voice Test Widget ─────────────────────────────────────
// Connects to OpenAI Realtime API via WebRTC for live voice testing.
// Flow: get ephemeral token → RTCPeerConnection → mic audio → AI responds

export function renderVoiceTest(systemPrompt) {
    const el = document.createElement('div');
    el.className = 'voice-tester';

    let pc = null;         // RTCPeerConnection
    let dc = null;         // DataChannel
    let audioEl = null;    // Remote audio playback
    let localStream = null;
    let isActive = false;
    let transcriptLines = [];

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
                stopSession();
            } else {
                await startSession();
            }
        });

        function appendTranscript(role, text) {
            const line = document.createElement('div');
            line.className = `transcript-line transcript-${role}`;
            line.innerHTML = `<span class="transcript-role">${role === 'user' ? '🎤 You' : '🤖 Agent'}:</span> ${text}`;
            transcriptScroll.appendChild(line);
            transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
            transcriptDiv.style.display = 'block';
        }

        async function startSession() {
            try {
                status.textContent = 'Connecting to OpenAI Realtime...';
                status.style.color = 'var(--accent-cyan)';
                btn.disabled = true;

                // 1. Get ephemeral token from our backend proxy
                const tokenResp = await fetch('/api/realtime/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'gpt-4o-realtime-preview',
                        voice: 'ash',
                        instructions: systemPrompt || 'You are a helpful voice AI assistant. Keep responses concise.',
                    }),
                });

                const tokenData = await tokenResp.json();
                if (!tokenResp.ok) {
                    throw new Error(tokenData.error || 'Failed to get token');
                }

                const ephemeralKey = tokenData.token;

                // 2. Create RTCPeerConnection
                pc = new RTCPeerConnection();

                // 3. Set up remote audio playback (AI voice output)
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                pc.ontrack = (e) => {
                    audioEl.srcObject = e.streams[0];
                };

                // 4. Get microphone and add local audio track
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                pc.addTrack(localStream.getTracks()[0]);

                // 5. Create data channel for events
                dc = pc.createDataChannel('oai-events');

                let currentAssistantText = '';
                let currentUserText = '';

                dc.onopen = () => {
                    console.log('[VoiceTest] Data channel open');
                    // Send session update with instructions
                    dc.send(JSON.stringify({
                        type: 'session.update',
                        session: {
                            instructions: systemPrompt || 'You are a helpful voice AI assistant. Keep responses concise.',
                            voice: 'ash',
                            input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                            turn_detection: {
                                type: 'server_vad',
                                threshold: 0.5,
                                prefix_padding_ms: 300,
                                silence_duration_ms: 500,
                            },
                        },
                    }));
                };

                dc.onmessage = (e) => {
                    try {
                        const event = JSON.parse(e.data);

                        switch (event.type) {
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
                                status.textContent = '🔴 Listening...';
                                status.style.color = 'var(--accent-rose)';
                                break;

                            case 'input_audio_buffer.speech_stopped':
                                status.textContent = '🤔 Thinking...';
                                status.style.color = 'var(--accent-cyan)';
                                break;

                            case 'response.audio.delta':
                                status.textContent = '🔊 Agent speaking...';
                                status.style.color = 'var(--accent-purple)';
                                break;

                            case 'response.done':
                                status.textContent = '🎙️ Your turn — speak to your agent';
                                status.style.color = 'var(--accent-green)';
                                break;

                            case 'error':
                                console.error('[VoiceTest] API error:', event.error);
                                appendTranscript('agent', `⚠️ Error: ${event.error?.message || 'Unknown error'}`);
                                break;
                        }
                    } catch (err) {
                        console.error('[VoiceTest] Parse error:', err);
                    }
                };

                // 6. SDP offer/answer exchange
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                const sdpResp = await fetch('https://api.openai.com/v1/realtime/calls', {
                    method: 'POST',
                    body: offer.sdp,
                    headers: {
                        'Authorization': `Bearer ${ephemeralKey}`,
                        'Content-Type': 'application/sdp',
                    },
                });

                if (!sdpResp.ok) {
                    throw new Error(`SDP exchange failed: ${sdpResp.status}`);
                }

                const answerSdp = await sdpResp.text();
                await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

                // Connected!
                isActive = true;
                btn.disabled = false;
                btn.classList.add('recording');
                btn.textContent = '⏹️';
                viz.classList.add('active');
                status.textContent = '🎙️ Connected — speak to your agent';
                status.style.color = 'var(--accent-green)';
                transcriptScroll.innerHTML = '';
                transcriptDiv.style.display = 'block';

            } catch (err) {
                console.error('[VoiceTest] Connection error:', err);
                btn.disabled = false;
                status.textContent = `❌ ${err.message}`;
                status.style.color = 'var(--accent-rose)';
                stopSession();
            }
        }

        function stopSession() {
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
            status.textContent = 'Test ended. Click to start again.';
            status.style.color = 'var(--text-tertiary)';
        }
    });

    return el;
}
