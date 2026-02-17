// ── Agent Card Component ──────────────────────────────────

export function renderAgentCard(agent, { onEdit, onToggle, onDelete }) {
    const el = document.createElement('div');
    el.className = 'agent-card';
    el.setAttribute('data-agent-id', agent.id);

    const initials = agent.name
        .split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const updated = new Date(agent.updatedAt).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
    });

    el.innerHTML = `
    <div class="agent-card-header">
      <div>
        <div class="agent-card-name">${escapeHtml(agent.name)}</div>
      </div>
      <span class="status-badge ${agent.active ? 'active' : 'inactive'}">
        ${agent.active ? 'Active' : 'Inactive'}
      </span>
    </div>
    <p class="agent-card-desc">${escapeHtml(agent.description || 'No description')}</p>
    <div class="agent-card-meta">
      <span>📞 ${agent.phoneConfig?.phoneNumber || 'No number'}</span>
      <span>🔗 ${agent.webhooks?.length || 0} webhooks</span>
      <span>📅 ${updated}</span>
    </div>
    <div class="agent-card-actions mt-md" style="display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm agent-edit-btn">Edit</button>
      <button class="btn btn-ghost btn-sm agent-toggle-btn">${agent.active ? 'Deactivate' : 'Activate'}</button>
      <button class="btn btn-ghost btn-sm agent-delete-btn" style="color:var(--accent-rose);">Delete</button>
    </div>
  `;

    // Bind events after render
    requestAnimationFrame(() => {
        el.querySelector('.agent-edit-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onEdit(agent);
        });
        el.querySelector('.agent-toggle-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onToggle(agent);
        });
        el.querySelector('.agent-delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onDelete(agent);
        });
    });

    // Click card to edit
    el.addEventListener('click', () => onEdit(agent));

    return el;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
