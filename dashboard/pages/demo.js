// ── Google Meet Demo Page ─────────────────────────────────────
// Deploy an AI voice agent into a live Google Meet call via Recall.ai.

import { getAllAgents } from '../lib/storage.js';
import { buildToolsFromWebhooks } from '../components/webhook-builder.js';

const VOICE_OPTIONS = ['coral', 'alloy', 'ash', 'ballad', 'echo', 'sage', 'shimmer', 'verse'];

export function renderDemo(container) {
    // ── State ────────────────────────────────────────────────
    let agents = [];
    let selectedAgentId = null;
    let systemPrompt = '';
    let selectedVoice = 'coral';
    let meetUrl = '';
    let currentBotId = null;
    let currentSessionId = null;
    let statusPollingInterval = null;

    // ── Render ───────────────────────────────────────────────
    async function render() {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:var(--space-3xl);color:var(--text-secondary);"><div class="spinner"></div><span style="margin-left:var(--space-md);">Loading…</span></div>';

        agents = await getAllAgents();

        const page = document.createElement('div');
        page.className = 'page-container';

        page.innerHTML = `
            <div style="margin-bottom:var(--space-2xl);">
                <h1 style="font-size:var(--font-3xl);font-weight:800;background:var(--gradient-accent);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-0.025em;">Google Meet Demo</h1>
                <p style="color:var(--text-secondary);font-size:var(--font-base);margin-top:4px;">Deploy your AI agent into a live Google Meet call with high-quality audio</p>
            </div>

            <div class="glass-card" style="padding:var(--space-2xl);">
                <!-- Agent Selector -->
                <div class="form-group">
                    <label class="form-label">Load from Agent</label>
                    <select class="form-select" id="agentSelect">
                        <option value="">— Custom config —</option>
                        ${agents.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
                    </select>
                    <p class="form-hint">Select an existing agent to load its prompt and voice, or configure below.</p>
                </div>

                <!-- System Prompt -->
                <div class="form-group">
                    <label class="form-label">System Prompt</label>
                    <textarea class="form-textarea" id="demoPrompt" rows="10" placeholder="Enter your system prompt here…"></textarea>
                </div>

                <!-- Voice -->
                <div class="form-group">
                    <label class="form-label">Voice</label>
                    <select class="form-select" id="voiceSelect">
                        ${VOICE_OPTIONS.map(v => `<option value="${v}" ${selectedVoice === v ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}
                    </select>
                </div>

                <!-- Google Meet URL -->
                <div class="form-group">
                    <label class="form-label">Google Meet Link</label>
                    <input class="form-input" type="url" id="meetUrl" placeholder="https://meet.google.com/xxx-xxxx-xxx" />
                    <p class="form-hint">Paste the full Google Meet URL. The AI agent will join as a participant.</p>
                </div>

                <!-- Actions -->
                <div class="demo-actions" id="demoActions">
                    <button class="btn btn-primary btn-lg" id="launchBtn">Launch Agent</button>
                </div>

                <!-- Status Panel -->
                <div class="demo-status-panel" id="statusPanel" style="display:none;">
                    <div class="demo-status-indicator" id="statusDot"></div>
                    <div>
                        <div class="demo-status-text" id="statusText"></div>
                        <div class="demo-status-sub" id="statusSub"></div>
                    </div>
                </div>

                <!-- Error -->
                <div class="demo-error" id="demoError" style="display:none;"></div>
            </div>
        `;

        container.innerHTML = '';
        container.appendChild(page);
        bindEvents();
    }

    // ── Bind Events ──────────────────────────────────────────
    function bindEvents() {
        const agentSelect = document.getElementById('agentSelect');
        const promptEl = document.getElementById('demoPrompt');
        const voiceSelect = document.getElementById('voiceSelect');
        const meetUrlInput = document.getElementById('meetUrl');
        const launchBtn = document.getElementById('launchBtn');

        // Restore state
        if (promptEl) promptEl.value = systemPrompt;
        if (meetUrlInput) meetUrlInput.value = meetUrl;

        // Agent selector → loads prompt + voice
        agentSelect?.addEventListener('change', (e) => {
            const id = e.target.value;
            if (!id) { selectedAgentId = null; return; }
            const agent = agents.find(a => String(a.id) === String(id));
            if (agent) {
                selectedAgentId = agent.id;
                systemPrompt = agent.systemPrompt || '';
                selectedVoice = agent.phoneConfig?.voice || 'coral';
                if (promptEl) promptEl.value = systemPrompt;
                if (voiceSelect) voiceSelect.value = selectedVoice;
            }
        });

        promptEl?.addEventListener('input', (e) => { systemPrompt = e.target.value; });
        voiceSelect?.addEventListener('change', (e) => { selectedVoice = e.target.value; });
        meetUrlInput?.addEventListener('input', (e) => { meetUrl = e.target.value; });
        launchBtn?.addEventListener('click', () => launchAgent());

        // If there's an active session, show it
        if (currentBotId) {
            showActiveSession();
            startStatusPolling();
        }
    }

    // ── Launch ───────────────────────────────────────────────
    async function launchAgent() {
        hideError();

        if (!meetUrl || !meetUrl.includes('meet.google.com')) {
            showError('Please enter a valid Google Meet URL (e.g. https://meet.google.com/xxx-xxxx-xxx)');
            return;
        }
        if (!systemPrompt.trim()) {
            showError('Please enter a system prompt or select an agent.');
            return;
        }

        // Build tools from selected agent's webhooks
        let tools = [];
        if (selectedAgentId) {
            const agent = agents.find(a => String(a.id) === String(selectedAgentId));
            if (agent && agent.webhooks && agent.webhooks.length > 0) {
                tools = buildToolsFromWebhooks(agent.webhooks);
            }
        }

        const launchBtn = document.getElementById('launchBtn');
        if (launchBtn) { launchBtn.textContent = 'Launching…'; launchBtn.disabled = true; }

        try {
            const resp = await fetch('/api/recall/launch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meetUrl,
                    systemPrompt,
                    voice: selectedVoice,
                    tools,
                }),
            });

            const result = await resp.json();

            if (!resp.ok || !result.success) {
                throw new Error(result.error || 'Failed to launch agent');
            }

            currentBotId = result.botId;
            currentSessionId = result.sessionId;
            showActiveSession();
            startStatusPolling();

        } catch (err) {
            showError(err.message);
            if (launchBtn) { launchBtn.textContent = 'Launch Agent'; launchBtn.disabled = false; }
        }
    }

    // ── Active Session UI ────────────────────────────────────
    function showActiveSession() {
        const actions = document.getElementById('demoActions');
        if (actions) {
            actions.innerHTML = `
                <button class="btn btn-danger" id="endBtn">End Session</button>
                <span style="color:var(--text-tertiary);font-size:var(--font-sm);">Bot ID: ${currentBotId?.substring(0, 8)}…</span>
            `;
            actions.querySelector('#endBtn')?.addEventListener('click', () => endSession());
        }

        updateStatusUI('joining', 'Bot is joining the meeting…');
    }

    function updateStatusUI(statusCode, message) {
        const panel = document.getElementById('statusPanel');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const sub = document.getElementById('statusSub');

        if (panel) panel.style.display = 'flex';

        // Map Recall.ai status codes to UI states
        let uiState = 'joining';
        let displayText = message || statusCode;

        if (statusCode?.includes('in_call') || statusCode === 'active') {
            uiState = 'in_call';
            displayText = 'Agent is active in the meeting';
        } else if (statusCode?.includes('joining') || statusCode === 'scheduling' || statusCode === 'joining') {
            uiState = 'joining';
            displayText = 'Bot is joining the meeting…';
        } else if (statusCode?.includes('waiting_room')) {
            uiState = 'joining';
            displayText = 'Bot is in the waiting room — please admit it';
        } else if (statusCode?.includes('done') || statusCode?.includes('ended') || statusCode === 'ended') {
            uiState = 'done';
            displayText = 'Session ended';
        } else if (statusCode?.includes('fatal') || statusCode?.includes('error')) {
            uiState = 'error';
            displayText = message || 'An error occurred';
        }

        if (dot) { dot.className = 'demo-status-indicator ' + uiState; }
        if (text) { text.textContent = displayText; }
        if (sub) { sub.textContent = currentBotId ? `Bot: ${currentBotId.substring(0, 12)}…` : ''; }
    }

    // ── Status Polling ───────────────────────────────────────
    function startStatusPolling() {
        if (statusPollingInterval) clearInterval(statusPollingInterval);

        statusPollingInterval = setInterval(async () => {
            if (!currentBotId) { clearInterval(statusPollingInterval); return; }

            try {
                const resp = await fetch(`/api/recall/status?botId=${currentBotId}`);
                const data = await resp.json();
                updateStatusUI(data.status, data.statusMessage);

                // Auto-stop polling if bot is done
                if (data.status?.includes('done') || data.status?.includes('ended')) {
                    clearInterval(statusPollingInterval);
                    statusPollingInterval = null;
                    resetToLaunchState();
                }
            } catch (err) {
                console.error('[Demo] Status poll error:', err);
            }
        }, 3000);
    }

    // ── End Session ──────────────────────────────────────────
    async function endSession() {
        const endBtn = document.getElementById('endBtn');
        if (endBtn) { endBtn.textContent = 'Ending…'; endBtn.disabled = true; }

        try {
            await fetch('/api/recall/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botId: currentBotId }),
            });
        } catch (err) {
            console.error('[Demo] End session error:', err);
        }

        if (statusPollingInterval) { clearInterval(statusPollingInterval); statusPollingInterval = null; }
        updateStatusUI('done', 'Session ended');
        currentBotId = null;
        currentSessionId = null;

        setTimeout(() => resetToLaunchState(), 2000);
    }

    // ── Reset UI ─────────────────────────────────────────────
    function resetToLaunchState() {
        currentBotId = null;
        currentSessionId = null;

        const actions = document.getElementById('demoActions');
        if (actions) {
            actions.innerHTML = '<button class="btn btn-primary btn-lg" id="launchBtn">Launch Agent</button>';
            actions.querySelector('#launchBtn')?.addEventListener('click', () => launchAgent());
        }

        const panel = document.getElementById('statusPanel');
        if (panel) panel.style.display = 'none';
    }

    // ── Helpers ──────────────────────────────────────────────
    function showError(msg) {
        const el = document.getElementById('demoError');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    function hideError() {
        const el = document.getElementById('demoError');
        if (el) el.style.display = 'none';
    }

    // ── Init ─────────────────────────────────────────────────
    render();

    // Return cleanup function for router
    return () => {
        if (statusPollingInterval) { clearInterval(statusPollingInterval); statusPollingInterval = null; }
    };
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
