// ── Supabase CRUD for Voice AI Agents ─────────────────────
// All operations read/write directly to Supabase Postgres.
// Railway bot reads from the same table at call time — no proxy needed.

import { supabase } from './supabase.js';

const TABLE = 'voice_agents';

// ── Helpers ─────────────────────────────────────────────

/** Map a database row (snake_case) → dashboard agent object (camelCase) */
function rowToAgent(row) {
    return {
        id: row.id,
        name: row.name || '',
        description: row.description || '',
        systemPrompt: row.system_prompt || '',
        webhooks: row.webhooks || [],
        phoneConfig: {
            phoneNumber: row.phone_number || '',
            voice: row.voice || 'sage',
            vadThreshold: row.vad_threshold ?? 0.55,
            stopSecs: row.stop_secs ?? 0.7,
        },
        active: row.active ?? true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** Map a dashboard agent object → database columns */
function agentToRow(agent) {
    const row = {};
    if (agent.name !== undefined) row.name = agent.name;
    if (agent.description !== undefined) row.description = agent.description;
    if (agent.systemPrompt !== undefined) row.system_prompt = agent.systemPrompt;
    if (agent.webhooks !== undefined) row.webhooks = agent.webhooks;
    if (agent.active !== undefined) row.active = agent.active;
    if (agent.phoneConfig) {
        if (agent.phoneConfig.phoneNumber !== undefined) row.phone_number = agent.phoneConfig.phoneNumber;
        if (agent.phoneConfig.voice !== undefined) row.voice = agent.phoneConfig.voice;
        if (agent.phoneConfig.vadThreshold !== undefined) row.vad_threshold = agent.phoneConfig.vadThreshold;
        if (agent.phoneConfig.stopSecs !== undefined) row.stop_secs = agent.phoneConfig.stopSecs;
    }
    return row;
}

// ── CRUD Operations ─────────────────────────────────────

/**
 * Fetch all agents from the database.
 * @returns {Promise<Array>} Array of agent objects
 */
export async function getAllAgents() {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[storage] Failed to fetch agents:', error.message);
        return [];
    }
    return (data || []).map(rowToAgent);
}

/**
 * Get a single agent by its database ID.
 * @param {string|number} id
 * @returns {Promise<Object|null>}
 */
export async function getAgent(id) {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('[storage] Failed to fetch agent:', error.message);
        return null;
    }
    return data ? rowToAgent(data) : null;
}

/**
 * Create a new agent in the database.
 * @param {Object} agentData — camelCase dashboard format
 * @returns {Promise<Object|null>} The created agent
 */
export async function createAgent(agentData) {
    const row = {
        name: agentData.name || 'Untitled Agent',
        description: agentData.description || '',
        system_prompt: agentData.systemPrompt || '',
        webhooks: agentData.webhooks || [],
        phone_number: agentData.phoneConfig?.phoneNumber || '',
        voice: agentData.phoneConfig?.voice || 'sage',
        vad_threshold: agentData.phoneConfig?.vadThreshold ?? 0.55,
        stop_secs: agentData.phoneConfig?.stopSecs ?? 0.7,
        active: true,
    };

    const { data, error } = await supabase
        .from(TABLE)
        .insert(row)
        .select()
        .single();

    if (error) {
        console.error('[storage] Failed to create agent:', error.message);
        return null;
    }

    console.log(`[storage] ✓ Created agent "${data.name}" (id=${data.id})`);
    return rowToAgent(data);
}

/**
 * Update an existing agent.
 * @param {string|number} id
 * @param {Object} updates — camelCase partial update
 * @returns {Promise<Object|null>}
 */
export async function updateAgent(id, updates) {
    const row = agentToRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from(TABLE)
        .update(row)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('[storage] Failed to update agent:', error.message);
        return null;
    }

    console.log(`[storage] ✓ Updated agent "${data.name}" (id=${data.id})`);
    return rowToAgent(data);
}

/**
 * Delete an agent from the database.
 * @param {string|number} id
 */
export async function deleteAgent(id) {
    const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('id', id);

    if (error) {
        console.error('[storage] Failed to delete agent:', error.message);
    } else {
        console.log(`[storage] ✓ Deleted agent id=${id}`);
    }
}

/**
 * Toggle an agent's active status.
 * @param {string|number} id
 * @returns {Promise<Object|null>} The updated agent
 */
export async function toggleAgent(id) {
    // Fetch current state
    const current = await getAgent(id);
    if (!current) return null;

    const newActive = !current.active;
    const { data, error } = await supabase
        .from(TABLE)
        .update({ active: newActive, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('[storage] Failed to toggle agent:', error.message);
        return null;
    }

    console.log(`[storage] ✓ Toggled agent "${data.name}" → ${newActive ? 'active' : 'inactive'}`);
    return rowToAgent(data);
}
