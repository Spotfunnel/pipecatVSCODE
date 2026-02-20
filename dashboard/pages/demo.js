// ── Demo Page — Outbound Call Tester ──────────────────────
// Quick way to test Opus HD audio by having the bot call your phone.

const BOT_SERVER_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOT_SERVER_URL)
    || 'https://api.newspotfunnel.com';

export function renderDemo(container) {
    container.innerHTML = `
        <div class="page-container" style="max-width: 640px;">
            <div class="page-header">
                <h1>Call Tester</h1>
                <p>Test your AI agent with an outbound call</p>
            </div>

            <div class="glass-card">
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

    callBtn.addEventListener('click', async () => {
        const phone = phoneInput.value.trim();
        if (!phone) {
            phoneInput.focus();
            return;
        }

        // Save for next time
        localStorage.setItem('demo_phone', phone);
        if (fromInput.value.trim()) localStorage.setItem('demo_from', fromInput.value.trim());

        callBtn.disabled = true;
        callBtn.textContent = 'Calling...';
        statusDiv.style.display = 'block';
        statusContent.innerHTML = `
            <div style="padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-md); border: 1px solid var(--border-default);">
                <span style="color: var(--accent-amber);">Initiating call...</span>
            </div>
        `;

        try {
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
                statusContent.innerHTML = `
                    <div style="padding: var(--space-md); background: var(--accent-emerald-glow); border-radius: var(--radius-md); border: 1px solid rgba(16, 185, 129, 0.3);">
                        <div style="color: var(--accent-emerald); font-weight: 600; margin-bottom: var(--space-xs);">Call initiated</div>
                        <div style="font-size: var(--font-sm); color: var(--text-secondary);">
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
