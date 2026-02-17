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
        payloadFields: ['caller_number', 'transcript'],
    };
}

function renderPayloadPreview(webhook) {
    const payload = {};
    webhook.payloadFields.forEach(field => {
        switch (field) {
            case 'caller_number': payload.caller_number = '+61412345678'; break;
            case 'transcript': payload.transcript = 'Hi, I would like to book an appointment...'; break;
            case 'call_duration': payload.call_duration_seconds = 142; break;
            case 'custom_data': payload.custom_data = {}; break;
            case 'extracted_fields': payload.extracted_fields = { name: 'John', email: 'john@example.com' }; break;
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
    }

    render();
    return el;
}
