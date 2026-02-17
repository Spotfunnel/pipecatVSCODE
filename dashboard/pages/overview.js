// ── Overview Page ─────────────────────────────────────────

import { renderAgentCard } from '../components/agent-card.js';
import { getAllAgents, deleteAgent, toggleAgent, updateAgent } from '../lib/storage.js';
import { navigate } from '../lib/router.js';

export function renderOverview(container) {

    function render() {
        const agents = getAllAgents();

        const page = document.createElement('div');
        page.className = 'page-container';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2xl);';
        header.innerHTML = `
      <div>
        <h1 style="font-size:var(--font-3xl);font-weight:800;background:var(--gradient-accent);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-0.025em;">Your Agents</h1>
        <p style="color:var(--text-secondary);font-size:var(--font-base);margin-top:4px;">${agents.length} agent${agents.length !== 1 ? 's' : ''} configured</p>
      </div>
    `;

        const createBtn = document.createElement('button');
        createBtn.className = 'btn btn-primary';
        createBtn.innerHTML = '+ New Agent';
        createBtn.addEventListener('click', () => navigate('/onboarding'));
        header.appendChild(createBtn);
        page.appendChild(header);

        if (agents.length === 0) {
            // Empty state
            const empty = document.createElement('div');
            empty.className = 'glass-card empty-state';
            empty.innerHTML = `
        <div class="empty-state-icon">🤖</div>
        <h3>No agents yet</h3>
        <p>Create your first voice AI agent to get started. It only takes a few minutes.</p>
      `;
            const startBtn = document.createElement('button');
            startBtn.className = 'btn btn-primary btn-lg';
            startBtn.innerHTML = '🚀 Create Your First Agent';
            startBtn.addEventListener('click', () => navigate('/onboarding'));
            empty.appendChild(startBtn);
            page.appendChild(empty);
        } else {
            // Agent grid
            const grid = document.createElement('div');
            grid.className = 'agent-grid';

            agents.forEach(agent => {
                const card = renderAgentCard(agent, {
                    onEdit: (a) => showEditModal(a),
                    onToggle: (a) => {
                        toggleAgent(a.id);
                        render();
                    },
                    onDelete: (a) => showDeleteConfirm(a),
                });
                grid.appendChild(card);
            });

            page.appendChild(grid);
        }

        container.innerHTML = '';
        container.appendChild(page);
    }

    // ── Edit Modal ──────────────────────────────────────
    function showEditModal(agent) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        let activeTab = 'name';
        const editData = { ...agent, phoneConfig: { ...agent.phoneConfig }, webhooks: [...(agent.webhooks || [])] };

        function renderModal() {
            overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h2>Edit Agent</h2>
            <button class="modal-close" id="modalClose">✕</button>
          </div>
          <div class="modal-tabs">
            <button class="modal-tab ${activeTab === 'name' ? 'active' : ''}" data-tab="name">Details</button>
            <button class="modal-tab ${activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt">Prompt</button>
            <button class="modal-tab ${activeTab === 'webhooks' ? 'active' : ''}" data-tab="webhooks">Webhooks</button>
            <button class="modal-tab ${activeTab === 'phone' ? 'active' : ''}" data-tab="phone">Phone</button>
          </div>
          <div class="modal-body" id="modalBody"></div>
          <div class="modal-footer">
            <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="saveBtn">Save Changes</button>
          </div>
        </div>
      `;

            const body = overlay.querySelector('#modalBody');
            renderTabContent(body);

            // Tab clicks
            overlay.querySelectorAll('.modal-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    activeTab = tab.dataset.tab;
                    renderModal();
                });
            });

            // Close
            overlay.querySelector('#modalClose')?.addEventListener('click', () => overlay.remove());
            overlay.querySelector('#cancelBtn')?.addEventListener('click', () => overlay.remove());

            // Save
            overlay.querySelector('#saveBtn')?.addEventListener('click', () => {
                updateAgent(agent.id, editData);
                overlay.remove();
                render();
            });

            // Click outside
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.remove();
            });
        }

        function renderTabContent(body) {
            switch (activeTab) {
                case 'name':
                    body.innerHTML = `
            <div class="form-group">
              <label class="form-label">Agent Name</label>
              <input class="form-input" type="text" id="editName" value="${escapeAttr(editData.name)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input class="form-input" type="text" id="editDesc" value="${escapeAttr(editData.description || '')}" />
            </div>
          `;
                    body.querySelector('#editName')?.addEventListener('input', (e) => { editData.name = e.target.value; });
                    body.querySelector('#editDesc')?.addEventListener('input', (e) => { editData.description = e.target.value; });
                    break;

                case 'prompt':
                    body.innerHTML = `
            <div class="form-group">
              <label class="form-label">System Prompt</label>
              <textarea class="form-textarea" id="editPrompt" rows="16">${editData.systemPrompt || ''}</textarea>
            </div>
          `;
                    body.querySelector('#editPrompt')?.addEventListener('input', (e) => { editData.systemPrompt = e.target.value; });
                    break;

                case 'webhooks':
                    body.innerHTML = '<div id="editWebhookMount"></div>';
                    const mount = body.querySelector('#editWebhookMount');
                    if (mount) {
                        const { renderWebhookBuilder } = window._webhookBuilder || {};
                        // Inline a simple version for the modal
                        editData.webhooks.forEach((wh, i) => {
                            const item = document.createElement('div');
                            item.className = 'webhook-item mb-md';
                            item.innerHTML = `
                <div class="webhook-fields">
                  <div class="form-group">
                    <label class="form-label">Name</label>
                    <input class="form-input" type="text" value="${escapeAttr(wh.name)}" data-idx="${i}" data-field="name" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">URL</label>
                    <input class="form-input" type="url" value="${escapeAttr(wh.url)}" data-idx="${i}" data-field="url" />
                  </div>
                </div>
              `;
                            item.querySelectorAll('input').forEach(input => {
                                input.addEventListener('input', (e) => {
                                    const idx = parseInt(e.target.dataset.idx);
                                    const field = e.target.dataset.field;
                                    editData.webhooks[idx][field] = e.target.value;
                                });
                            });
                            mount.appendChild(item);
                        });

                        if (editData.webhooks.length === 0) {
                            mount.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:var(--space-xl);">No webhooks configured. Add them via the onboarding wizard.</p>';
                        }
                    }
                    break;

                case 'phone':
                    body.innerHTML = `
            <div class="form-group">
              <label class="form-label">Phone Number</label>
              <input class="form-input" type="tel" id="editPhone" value="${editData.phoneConfig?.phoneNumber || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">Voice</label>
              <select class="form-select" id="editVoice">
                ${['coral', 'alloy', 'ash', 'ballad', 'echo', 'sage', 'shimmer', 'verse'].map(v =>
                        `<option value="${v}" ${editData.phoneConfig?.voice === v ? 'selected' : ''}>${v}</option>`
                    ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">VAD Threshold</label>
              <div class="range-row">
                <input class="range-slider" type="range" id="editVad" min="0.4" max="0.7" step="0.05" value="${editData.phoneConfig?.vadThreshold || 0.55}" />
                <span class="range-value" id="editVadVal">${editData.phoneConfig?.vadThreshold || 0.55}</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Response Latency (stop_secs)</label>
              <div class="range-row">
                <input class="range-slider" type="range" id="editLatency" min="0.3" max="1.5" step="0.1" value="${editData.phoneConfig?.stopSecs || 0.7}" />
                <span class="range-value" id="editLatVal">${editData.phoneConfig?.stopSecs || 0.7}s</span>
              </div>
            </div>
          `;
                    body.querySelector('#editPhone')?.addEventListener('input', (e) => { editData.phoneConfig.phoneNumber = e.target.value; });
                    body.querySelector('#editVoice')?.addEventListener('change', (e) => { editData.phoneConfig.voice = e.target.value; });
                    body.querySelector('#editVad')?.addEventListener('input', (e) => {
                        editData.phoneConfig.vadThreshold = parseFloat(e.target.value);
                        const val = body.querySelector('#editVadVal');
                        if (val) val.textContent = e.target.value;
                    });
                    body.querySelector('#editLatency')?.addEventListener('input', (e) => {
                        editData.phoneConfig.stopSecs = parseFloat(e.target.value);
                        const val = body.querySelector('#editLatVal');
                        if (val) val.textContent = e.target.value + 's';
                    });
                    break;
            }
        }

        renderModal();
        document.body.appendChild(overlay);
    }

    // ── Delete Confirm ──────────────────────────────────
    function showDeleteConfirm(agent) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay confirm-dialog';
        overlay.innerHTML = `
      <div class="modal" style="max-width:420px;text-align:center;">
        <div class="modal-body" style="padding:var(--space-2xl);">
          <div class="confirm-icon">⚠️</div>
          <h3 style="margin-bottom:var(--space-sm);">Delete ${escapeHtml(agent.name)}?</h3>
          <p class="confirm-message">This action cannot be undone. The agent and all its configuration will be permanently removed.</p>
          <div style="display:flex;gap:var(--space-md);justify-content:center;">
            <button class="btn btn-ghost" id="cancelDelete">Cancel</button>
            <button class="btn btn-danger" id="confirmDelete">Delete Agent</button>
          </div>
        </div>
      </div>
    `;

        overlay.querySelector('#cancelDelete')?.addEventListener('click', () => overlay.remove());
        overlay.querySelector('#confirmDelete')?.addEventListener('click', () => {
            deleteAgent(agent.id);
            overlay.remove();
            render();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.body.appendChild(overlay);
    }

    render();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
