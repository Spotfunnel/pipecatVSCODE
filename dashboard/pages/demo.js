// ── Demo Page — Outbound Call Tester ──────────────────────
// Quick way to test Opus HD audio by having the bot call your phone.
// Supports picking an existing agent or entering a custom prompt.

import { getAllAgents, syncToServer } from '../lib/storage.js';

const BOT_SERVER_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOT_SERVER_URL)
    || 'https://api.newspotfunnel.com';

export function renderDemo(container) {
    const agents = getAllAgents();
    const activeAgent = agents.find(a => a.active);

    container.innerHTML = `
        <div class="page-container" style="max-width: 640px;">
            <div class="page-header">
                <h1>Call Tester</h1>
                <p>Test your AI agent with an outbound call</p>
            </div>

            <div class="glass-card">
                <div class="form-group">
                    <label class="form-label">Agent</label>
                    <select id="demo-agent" class="form-select">
                        ${agents.map(a => `<option value="${a.id}" ${a.active ? 'selected' : ''}>${a.name}${a.active ? ' (active)' : ''}</option>`).join('')}
                        <option value="__custom__">Custom prompt...</option>
                    </select>
                    <p class="form-hint">Select an agent or write a custom prompt for this call</p>
                </div>

                <div id="demo-custom-prompt-wrap" class="form-group" style="display: none;">
                    <label class="form-label">Custom Prompt</label>
                    <textarea
                        id="demo-custom-prompt"
                        class="form-textarea"
                        rows="6"
                        placeholder="You are a friendly AI assistant calling to confirm an appointment..."
                    ></textarea>
                </div>

                <div id="demo-agent-preview" class="form-group" style="display: ${activeAgent ? 'block' : 'none'};">
                    <div style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-default);">
                        <div style="font-size: var(--font-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-xs);">Agent Preview</div>
                        <div id="demo-agent-name" style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${activeAgent?.name || ''}</div>
                        <div id="demo-agent-prompt" style="font-size: var(--font-sm); color: var(--text-secondary); max-height: 60px; overflow: hidden; text-overflow: ellipsis;">${activeAgent?.systemPrompt?.substring(0, 150) || ''}${(activeAgent?.systemPrompt?.length || 0) > 150 ? '...' : ''}</div>
                        <div id="demo-agent-voice" style="font-size: var(--font-xs); color: var(--accent-blue); margin-top: var(--space-xs);">Voice: ${activeAgent?.phoneConfig?.voice || 'sage'}</div>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Phone Number</label>
                    <input
                        type="tel"
                        id="demo-phone"
                        class="form-input"
                        placeholder="+61412345678"
                        style="font-size: var(--font-lg);"
                    />
                    <p class="form-hint">E.164 format — include country code</p>
                </div>

                <div class="form-group">
                    <label class="form-label">From Number (optional)</label>
                    <input
                        type="tel"
                        id="demo-from"
                        class="form-input"
                        placeholder="Auto-detect from active agent"
                    />
                    <p class="form-hint">Leave blank to use the active agent's Telnyx number</p>
                </div>

                <button id="demo-call-btn" class="btn btn-primary btn-lg" style="width: 100%; margin-top: var(--space-lg);">
                    Call Me
                </button>

                <div id="demo-status" style="margin-top: var(--space-lg); display: none;">
                    <div id="demo-status-content"></div>
                </div>
            </div>

            <div class="glass-card" style="margin-top: var(--space-lg);">
                <div style="display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md);">
                    <span style="font-size: 1.2rem;">&#x1f50a;</span>
                    <span style="font-weight: 600; color: var(--text-primary);">Audio Info</span>
                </div>
                <div style="font-size: var(--font-sm); color: var(--text-secondary); line-height: 1.8;">
                    <div style="display: flex; justify-content: space-between; padding: var(--space-xs) 0; border-bottom: 1px solid var(--border-subtle);">
                        <span>Codec</span>
                        <span style="color: var(--accent-emerald); font-weight: 600;">Opus HD</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: var(--space-xs) 0; border-bottom: 1px solid var(--border-subtle);">
                        <span>Sample Rate</span>
                        <span style="color: var(--accent-blue); font-weight: 600;">16,000 Hz</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: var(--space-xs) 0; border-bottom: 1px solid var(--border-subtle);">
                        <span>Bandwidth</span>
                        <span style="color: var(--text-primary); font-weight: 600;">Wideband (0-8 kHz)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: var(--space-xs) 0;">
                        <span>Previous</span>
                        <span style="color: var(--text-tertiary);">PCMU 8kHz narrowband</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    const agentSelect = document.getElementById('demo-agent');
    const customPromptWrap = document.getElementById('demo-custom-prompt-wrap');
    const customPromptInput = document.getElementById('demo-custom-prompt');
    const agentPreview = document.getElementById('demo-agent-preview');
    const agentNameEl = document.getElementById('demo-agent-name');
    const agentPromptEl = document.getElementById('demo-agent-prompt');
    const agentVoiceEl = document.getElementById('demo-agent-voice');
    const phoneInput = document.getElementById('demo-phone');
    const fromInput = document.getElementById('demo-from');
    const callBtn = document.getElementById('demo-call-btn');
    const statusDiv = document.getElementById('demo-status');
    const statusContent = document.getElementById('demo-status-content');

    // Restore last used number
    const savedPhone = localStorage.getItem('demo_phone');
    if (savedPhone) phoneInput.value = savedPhone;
    const savedFrom = localStorage.getItem('demo_from');
    if (savedFrom) fromInput.value = savedFrom;
    const savedCustomPrompt = localStorage.getItem('demo_custom_prompt');
    if (savedCustomPrompt) customPromptInput.value = savedCustomPrompt;

    // Agent selector change
    agentSelect.addEventListener('change', () => {
        const val = agentSelect.value;
        if (val === '__custom__') {
            customPromptWrap.style.display = 'block';
            agentPreview.style.display = 'none';
        } else {
            customPromptWrap.style.display = 'none';
            const agent = agents.find(a => a.id === val);
            if (agent) {
                agentPreview.style.display = 'block';
                agentNameEl.textContent = agent.name;
                const prompt = agent.systemPrompt || '';
                agentPromptEl.textContent = prompt.substring(0, 150) + (prompt.length > 150 ? '...' : '');
                agentVoiceEl.textContent = 'Voice: ' + (agent.phoneConfig?.voice || 'sage');
                // Auto-fill from number if the agent has one
                if (agent.phoneConfig?.phoneNumber && !fromInput.value.trim()) {
                    fromInput.value = agent.phoneConfig.phoneNumber;
                }
            }
        }
    });

    callBtn.addEventListener('click', async () => {
        const phone = phoneInput.value.trim();
        if (!phone) {
            phoneInput.focus();
            return;
        }

        // Save for next time
        localStorage.setItem('demo_phone', phone);
        if (fromInput.value.trim()) localStorage.setItem('demo_from', fromInput.value.trim());
        if (customPromptInput.value.trim()) localStorage.setItem('demo_custom_prompt', customPromptInput.value.trim());

        callBtn.disabled = true;
        callBtn.textContent = 'Calling...';
        statusDiv.style.display = 'block';
        statusContent.innerHTML = `
            <div style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-default);">
                <span style="color: var(--accent-amber);">Syncing agent config...</span>
            </div>
        `;

        try {
            // If custom prompt, create a temporary agent config and sync it
            const selectedVal = agentSelect.value;
            if (selectedVal === '__custom__') {
                const customPrompt = customPromptInput.value.trim() || 'You are a helpful AI assistant.';
                await syncToServer({
                    name: 'Call Tester (Custom)',
                    systemPrompt: customPrompt,
                    phoneConfig: {
                        phoneNumber: fromInput.value.trim() || '',
                        voice: 'sage',
                        vadThreshold: 0.55,
                        stopSecs: 0.7,
                    },
                    webhooks: [],
                    active: true,
                });
            } else {
                // Sync the selected agent so it's the one used for this call
                const agent = agents.find(a => a.id === selectedVal);
                if (agent) {
                    await syncToServer(agent);
                }
            }

            statusContent.innerHTML = `
                <div style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-default);">
                    <span style="color: var(--accent-amber);">Initiating call...</span>
                </div>
            `;

            const body = { to: phone };
            const from = fromInput.value.trim();
            if (from) body.from_number = from;

            const resp = await fetch(`${BOT_SERVER_URL}/api/outbound-call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();

            if (data.success) {
                const agentLabel = selectedVal === '__custom__' ? 'Custom prompt' : (agents.find(a => a.id === selectedVal)?.name || 'Unknown');
                statusContent.innerHTML = `
                    <div style="padding: var(--space-md); background: var(--accent-emerald-glow); border-radius: var(--radius-md); border: 1px solid rgba(16, 185, 129, 0.3);">
                        <div style="color: var(--accent-emerald); font-weight: 600; margin-bottom: var(--space-xs);">Call initiated</div>
                        <div style="font-size: var(--font-sm); color: var(--text-secondary);">
                            Agent: ${agentLabel}<br/>
                            To: ${data.message || phone}<br/>
                            From: ${data.from || 'auto'}<br/>
                            Codec: ${data.codec || 'OPUS'}
                        </div>
                    </div>
                `;
            } else {
                statusContent.innerHTML = `
                    <div style="padding: var(--space-md); background: var(--accent-rose-glow); border-radius: var(--radius-md); border: 1px solid rgba(244, 63, 94, 0.3);">
                        <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: var(--space-xs);">Failed</div>
                        <div style="font-size: var(--font-sm); color: var(--text-secondary);">${data.error || 'Unknown error'}</div>
                    </div>
                `;
            }
        } catch (err) {
            statusContent.innerHTML = `
                <div style="padding: var(--space-md); background: var(--accent-rose-glow); border-radius: var(--radius-md); border: 1px solid rgba(244, 63, 94, 0.3);">
                    <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: var(--space-xs);">Network Error</div>
                    <div style="font-size: var(--font-sm); color: var(--text-secondary);">${err.message}</div>
                </div>
            `;
        } finally {
            callBtn.disabled = false;
            callBtn.textContent = 'Call Me';
        }
    });
}
