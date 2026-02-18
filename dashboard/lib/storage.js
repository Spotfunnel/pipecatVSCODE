// ── localStorage CRUD for Voice AI Agents ─────────────────
// All mutations sync the active agent to the bot server automatically.

const STORAGE_KEY = 'voiceai_agents';

// Bot server URL — falls back to production Railway domain
const BOT_SERVER_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOT_SERVER_URL)
    || 'https://bot.spotfunnelmail.com';

function generateId() {
    return 'agent_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getAllAgents() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveAll(agents) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
}

/**
 * Sync the active agent's config to the bot server.
 * Sends systemPrompt, name, voice, webhooks, etc. so the bot
 * uses the latest config on the next call — no redeployment needed.
 */
export async function syncToServer(agent) {
    if (!agent) {
        console.warn('[sync] No agent provided, skipping sync');
        return { success: false, error: 'No agent' };
    }
    if (!agent.active) {
        console.log('[sync] Agent is inactive, skipping sync');
        return { success: false, error: 'Agent inactive' };
    }

    const payload = {
        name: agent.name,
        description: agent.description || '',
        systemPrompt: agent.systemPrompt || '',
        phoneConfig: {
            phoneNumber: agent.phoneConfig?.phoneNumber || '',
            voice: agent.phoneConfig?.voice || 'sage',
            vadThreshold: agent.phoneConfig?.vadThreshold ?? 0.55,
            stopSecs: agent.phoneConfig?.stopSecs ?? 0.7,
        },
        webhooks: agent.webhooks || [],
        active: agent.active,
    };

    try {
        console.log(`[sync] Syncing agent "${agent.name}" to ${BOT_SERVER_URL}/api/agent-config`);
        const resp = await fetch(`${BOT_SERVER_URL}/api/agent-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (data.success) {
            console.log(`[sync] ✓ Synced "${agent.name}" — voice=${data.voice}, webhooks=${data.webhooks}`);
        } else {
            console.error('[sync] ✗ Server returned error:', data.error);
        }
        return data;
    } catch (err) {
        console.error('[sync] ✗ Failed to sync:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Find and sync the currently active agent.
 * Called after mutations that might change which agent is active.
 */
export async function syncActiveAgent() {
    const agents = getAllAgents();
    const active = agents.find(a => a.active);
    if (active) {
        return syncToServer(active);
    } else {
        console.log('[sync] No active agent to sync');
        return { success: false, error: 'No active agent' };
    }
}

export function getAgent(id) {
    return getAllAgents().find(a => a.id === id) || null;
}

export function createAgent(agentData) {
    const agents = getAllAgents();
    const now = new Date().toISOString();
    const agent = {
        id: generateId(),
        name: agentData.name || 'Untitled Agent',
        description: agentData.description || '',
        systemPrompt: agentData.systemPrompt || '',
        webhooks: agentData.webhooks || [],
        phoneConfig: {
            phoneNumber: agentData.phoneConfig?.phoneNumber || '',
            voice: agentData.phoneConfig?.voice || 'sage',
            vadThreshold: agentData.phoneConfig?.vadThreshold ?? 0.55,
            stopSecs: agentData.phoneConfig?.stopSecs ?? 0.7,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
    };
    agents.push(agent);
    saveAll(agents);
    // Auto-sync to bot server
    syncToServer(agent).catch(err => console.error('[sync] Background sync failed:', err));
    return agent;
}

export function updateAgent(id, updates) {
    const agents = getAllAgents();
    const idx = agents.findIndex(a => a.id === id);
    if (idx === -1) return null;
    agents[idx] = {
        ...agents[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
    };
    saveAll(agents);
    // Auto-sync if this agent is active
    if (agents[idx].active) {
        syncToServer(agents[idx]).catch(err => console.error('[sync] Background sync failed:', err));
    }
    return agents[idx];
}

export function deleteAgent(id) {
    const agents = getAllAgents().filter(a => a.id !== id);
    saveAll(agents);
    // Sync the next active agent (if any)
    syncActiveAgent().catch(err => console.error('[sync] Background sync failed:', err));
}

export function toggleAgent(id) {
    const agents = getAllAgents();
    const agent = agents.find(a => a.id === id);
    if (agent) {
        agent.active = !agent.active;
        agent.updatedAt = new Date().toISOString();
        saveAll(agents);
        // Sync: if toggled ON, sync this agent; if toggled OFF, sync next active
        if (agent.active) {
            syncToServer(agent).catch(err => console.error('[sync] Background sync failed:', err));
        } else {
            syncActiveAgent().catch(err => console.error('[sync] Background sync failed:', err));
        }
    }
    return agent;
}
