// ── localStorage CRUD for Voice AI Agents ─────────────────

const STORAGE_KEY = 'voiceai_agents';

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
            voice: agentData.phoneConfig?.voice || 'coral',
            vadThreshold: agentData.phoneConfig?.vadThreshold ?? 0.55,
            stopSecs: agentData.phoneConfig?.stopSecs ?? 0.7,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
    };
    agents.push(agent);
    saveAll(agents);
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
    return agents[idx];
}

export function deleteAgent(id) {
    const agents = getAllAgents().filter(a => a.id !== id);
    saveAll(agents);
}

export function toggleAgent(id) {
    const agents = getAllAgents();
    const agent = agents.find(a => a.id === id);
    if (agent) {
        agent.active = !agent.active;
        agent.updatedAt = new Date().toISOString();
        saveAll(agents);
    }
    return agent;
}
