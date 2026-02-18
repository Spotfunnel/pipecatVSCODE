"""
Create the voice_agents table in Supabase (Postgres).
Run once: python execution/create_voice_agents_table.py
"""
import asyncio
import asyncpg
import os
import sys

# Use the direct (non-pooled) connection for DDL
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.lxsxwrunbmoiayhtexiz:Walkergewert01@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
)

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS voice_agents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'AI Assistant',
    description TEXT DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    voice TEXT DEFAULT 'sage',
    vad_threshold FLOAT DEFAULT 0.55,
    stop_secs FLOAT DEFAULT 0.7,
    phone_number TEXT DEFAULT '',
    webhooks JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for phone number lookups (the primary query path)
CREATE INDEX IF NOT EXISTS idx_voice_agents_phone ON voice_agents(phone_number);

-- Index for active agents
CREATE INDEX IF NOT EXISTS idx_voice_agents_active ON voice_agents(active);
"""

async def main():
    print(f"Connecting to database...")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(CREATE_TABLE_SQL)
        print("✓ voice_agents table created successfully")
        
        # Check if any agents exist
        count = await conn.fetchval("SELECT COUNT(*) FROM voice_agents")
        print(f"  Current agents: {count}")
        
        if count == 0:
            print("  No agents found. Creating a default agent...")
            await conn.execute("""
                INSERT INTO voice_agents (name, description, system_prompt, voice, phone_number, active)
                VALUES ($1, $2, $3, $4, $5, $6)
            """,
                "AI Assistant",
                "Default assistant — update via dashboard",
                "You are a helpful and professional AI assistant talking over the phone. Always respond in English. Be warm and conversational.",
                "sage",
                "",  # No phone number yet — will match any incoming call
                True,
            )
            print("  ✓ Default agent created")
    finally:
        await conn.close()
    
    print("\nDone! The voice_agents table is ready.")

if __name__ == "__main__":
    asyncio.run(main())
