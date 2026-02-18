// ── Supabase Client ───────────────────────────────────────
// Shared Supabase instance for the Voice AI Dashboard.
// Connects to the same Postgres database that Railway reads from.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    || 'https://kpvyguhkyotkfrwtcdtg.supabase.co';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY
    || '';

if (!SUPABASE_KEY) {
    console.warn('[supabase] No VITE_SUPABASE_KEY found — database operations will fail.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
