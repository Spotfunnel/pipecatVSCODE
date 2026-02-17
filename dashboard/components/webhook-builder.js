// ── Webhook Builder Component ─────────────────────────────

const TRIGGER_OPTIONS = [
    { value: 'on_tool_call', label: 'On Tool Call' },
    { value: 'end_of_call', label: 'End of Call' },
    { value: 'on_keyword', label: 'On Keyword' },
    { value: 'manual', label: 'Manual' },
];

const PAYLOAD_FIELDS = [
    'caller_number',
    'transcript',
    'call_duration',
    'summary',
    'address',
    'installer_message',
    'custom_data',
    'extracted_fields',
    'agent_name',
    'timestamp',
];

function generateWebhookId() {
    return 'wh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createEmptyWebhook() {
    return {
        id: generateWebhookId(),
        name: '',
        trigger: 'on_tool_call',
        url: '',
        payloadFields: ['caller_number', 'transcript', 'summary'],
    };
}

function renderPayloadPreview(webhook) {
    const payload = {};
    webhook.payloadFields.forEach(field => {
        switch (field) {
            case 'caller_number': payload.caller_number = '+61412345678'; break;
            case 'transcript': payload.transcript = 'Hi, I would like to book an appointment for a hot water system install...'; break;
            case 'call_duration': payload.call_duration_seconds = 142; break;
            case 'summary': payload.summary = 'Customer called to book a hot water system installation at their Bondi home. Confirmed 3pm Tuesday appointment. Prefers electric tankless unit.'; break;
            case 'address': payload.address = { street: '42 Ocean Avenue', suburb: 'Bondi', state: 'NSW', postcode: '2026' }; break;
            case 'installer_message': payload.installer_message = 'Customer has a narrow access path on the left side of the house. Electric tankless preferred. Old unit is a 250L gas storage — will need gas cap-off. Access code for gate: 4821.'; break;
            case 'custom_data': payload.custom_data = {}; break;
            case 'extracted_fields': payload.extracted_fields = { name: 'John Smith', email: 'john@example.com', service_type: 'Hot Water Install' }; break;
            case 'agent_name': payload.agent_name = 'Sales Assistant'; break;
            case 'timestamp': payload.timestamp = new Date().toISOString(); break;
        }
    });
    return JSON.stringify(payload, null, 2);
}

export function renderWebhookBuilder(webhooks = [], onChange) {
    const el = document.createElement('div');

    function render() {
        el.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'webhook-list';

        if (webhooks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = `
        <div class="empty-state-icon">🔗</div>
        <h3>No webhooks configured</h3>
        <p>Add webhooks to connect your agent to n8n workflows, CRMs, and other tools.</p>
      `;
            list.appendChild(empty);
        }

        webhooks.forEach((wh, i) => {
            const item = document.createElement('div');
            item.className = 'webhook-item';

            item.innerHTML = `
        <div class="webhook-item-header">
          <span class="webhook-item-number">Webhook ${i + 1}</span>
          <button class="webhook-remove" data-idx="${i}" title="Remove webhook">✕</button>
        </div>
        <div class="webhook-fields">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input wh-name" type="text" placeholder="e.g., Booking Request" value="${wh.name}" data-idx="${i}" />
          </div>
          <div class="form-group">
            <label class="form-label">Trigger</label>
            <select class="form-select wh-trigger" data-idx="${i}">
              ${TRIGGER_OPTIONS.map(opt =>
                `<option value="${opt.value}" ${wh.trigger === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
            </select>
          </div>
        </div>
        <div class="webhook-url-row form-group">
          <label class="form-label">Webhook URL</label>
          <input class="form-input wh-url" type="url" placeholder="https://n8n.example.com/webhook/..." value="${wh.url}" data-idx="${i}" />
        </div>
        <div class="form-group">
          <label class="form-label">Payload Fields</label>
          <div class="payload-checkboxes" data-idx="${i}">
            ${PAYLOAD_FIELDS.map(field => `
              <label class="payload-checkbox ${wh.payloadFields.includes(field) ? 'selected' : ''}">
                <input type="checkbox" value="${field}" ${wh.payloadFields.includes(field) ? 'checked' : ''} />
                ${field.replace(/_/g, ' ')}
              </label>
            `).join('')}
          </div>
        </div>
        <div class="payload-preview-label">Preview Payload</div>
        <pre class="payload-preview">${renderPayloadPreview(wh)}</pre>
        <div class="webhook-test-row">
          <button class="btn btn-secondary btn-sm wh-test-btn" data-idx="${i}" ${!wh.url ? 'disabled' : ''}>
            🚀 Send Test Payload
          </button>
          <span class="wh-test-status" data-idx="${i}"></span>
        </div>
      `;

            list.appendChild(item);
        });

        el.appendChild(list);

        // Add webhook button
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-secondary mt-lg';
        addBtn.innerHTML = '+ Add Webhook';
        addBtn.addEventListener('click', () => {
            webhooks.push(createEmptyWebhook());
            onChange(webhooks);
            render();
        });
        el.appendChild(addBtn);

        // Bind events
        bindEvents();
    }

    function bindEvents() {
        // Remove buttons
        el.querySelectorAll('.webhook-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.idx);
                webhooks.splice(idx, 1);
                onChange(webhooks);
                render();
            });
        });

        // Name inputs
        el.querySelectorAll('.wh-name').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                webhooks[idx].name = e.target.value;
                onChange(webhooks);
            });
        });

        // Trigger selects
        el.querySelectorAll('.wh-trigger').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                webhooks[idx].trigger = e.target.value;
                onChange(webhooks);
            });
        });

        // URL inputs
        el.querySelectorAll('.wh-url').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                webhooks[idx].url = e.target.value;
                onChange(webhooks);
                // Enable/disable test button
                const testBtn = el.querySelector(`.wh-test-btn[data-idx="${idx}"]`);
                if (testBtn) testBtn.disabled = !e.target.value;
            });
        });

        // Payload checkboxes
        el.querySelectorAll('.payload-checkboxes').forEach(group => {
            const idx = parseInt(group.dataset.idx);
            group.querySelectorAll('.payload-checkbox').forEach(label => {
                label.addEventListener('click', (e) => {
                    const checkbox = label.querySelector('input');
                    const field = checkbox.value;

                    // Toggle
                    if (webhooks[idx].payloadFields.includes(field)) {
                        webhooks[idx].payloadFields = webhooks[idx].payloadFields.filter(f => f !== field);
                        label.classList.remove('selected');
                        checkbox.checked = false;
                    } else {
                        webhooks[idx].payloadFields.push(field);
                        label.classList.add('selected');
                        checkbox.checked = true;
                    }

                    // Update preview
                    const preview = label.closest('.webhook-item').querySelector('.payload-preview');
                    if (preview) {
                        preview.textContent = renderPayloadPreview(webhooks[idx]);
                    }

                    onChange(webhooks);
                    e.preventDefault();
                });
            });
        });

        // Test payload buttons
        el.querySelectorAll('.wh-test-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.dataset.idx);
                const wh = webhooks[idx];
                const statusEl = el.querySelector(`.wh-test-status[data-idx="${idx}"]`);

                if (!wh.url) return;

                // Build payload
                const payload = JSON.parse(renderPayloadPreview(wh));

                // Update UI
                btn.disabled = true;
                btn.textContent = '⏳ Sending...';
                statusEl.textContent = '';
                statusEl.className = 'wh-test-status';

                try {
                    const resp = await fetch('/api/webhook/test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: wh.url, payload }),
                    });

                    const result = await resp.json();

                    if (resp.ok && result.success) {
                        statusEl.textContent = `✅ Sent! (${result.status})`;
                        statusEl.className = 'wh-test-status success';
                    } else {
                        statusEl.textContent = `❌ Failed: ${result.error || result.status}`;
                        statusEl.className = 'wh-test-status error';
                    }
                } catch (err) {
                    statusEl.textContent = `❌ ${err.message}`;
                    statusEl.className = 'wh-test-status error';
                }

                btn.disabled = false;
                btn.textContent = '🚀 Send Test Payload';

                // Auto-clear status after 8s
                setTimeout(() => {
                    if (statusEl) {
                        statusEl.textContent = '';
                        statusEl.className = 'wh-test-status';
                    }
                }, 8000);
            });
        });
    }

    render();
    return el;
}

// ── Build OpenAI tools array from webhook config ──────────
// Used by voice-test.js and telnyx_bot to register tools with the AI
export function buildToolsFromWebhooks(webhooks) {
    if (!webhooks || webhooks.length === 0) return [];

    return webhooks
        .filter(wh => wh.trigger === 'on_tool_call' && wh.name && wh.url)
        .map(wh => {
            const toolName = wh.name
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '') || 'webhook_action';

            // Build parameters from payload fields
            const properties = {};
            const descriptions = {
                caller_number: 'The caller phone number',
                transcript: 'Full conversation transcript',
                call_duration: 'Duration of the call in seconds',
                summary: 'Brief summary of the conversation and outcome',
                address: 'Customer address (street, suburb, state, postcode)',
                installer_message: 'Detailed message for the installer with special instructions, access notes, and job specifics',
                custom_data: 'Any additional custom data',
                extracted_fields: 'Extracted information like name, email, service type',
                agent_name: 'Name of the AI agent',
                timestamp: 'ISO timestamp of when this was triggered',
            };

            wh.payloadFields.forEach(field => {
                if (field === 'address') {
                    properties[field] = {
                        type: 'object',
                        description: descriptions[field],
                        properties: {
                            street: { type: 'string' },
                            suburb: { type: 'string' },
                            state: { type: 'string' },
                            postcode: { type: 'string' },
                        },
                    };
                } else if (field === 'extracted_fields') {
                    properties[field] = {
                        type: 'object',
                        description: 'All information collected from the caller during the conversation. ALWAYS include every piece of information the caller provided.',
                        properties: {
                            name: { type: 'string', description: 'Caller\'s full name' },
                            email: { type: 'string', description: 'Caller\'s email address' },
                            phone: { type: 'string', description: 'Caller\'s phone number' },
                            company: { type: 'string', description: 'Caller\'s company or business name' },
                            service_type: { type: 'string', description: 'Type of service requested' },
                            preferred_date: { type: 'string', description: 'Preferred date/time for appointment' },
                            notes: { type: 'string', description: 'Any other relevant details mentioned by the caller' },
                        },
                    };
                } else if (field === 'custom_data') {
                    properties[field] = {
                        type: 'object',
                        description: descriptions[field],
                    };
                } else if (field === 'call_duration') {
                    properties[field] = {
                        type: 'number',
                        description: descriptions[field],
                    };
                } else {
                    properties[field] = {
                        type: 'string',
                        description: descriptions[field] || field,
                    };
                }
            });

            return {
                type: 'function',
                name: toolName,
                description: `Trigger the "${wh.name}" webhook. Use this when the caller's request matches this action.`,
                parameters: {
                    type: 'object',
                    properties,
                },
                // Store the webhook URL for runtime lookup
                _webhookUrl: wh.url,
                _webhookId: wh.id,
            };
        });
}
