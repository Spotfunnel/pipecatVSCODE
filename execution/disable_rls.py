"""
Disable RLS on the voice_agents table and add a permissive policy.
The dashboard is an internal admin tool — no public-facing auth needed.
Run once: python execution/disable_rls.py
"""
import asyncio
import asyncpg
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.lxsxwrunbmoiayhtexiz:Walkergewert01@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
)

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Disable RLS on voice_agents (allows anon key to read/write)
        await conn.execute("ALTER TABLE voice_agents DISABLE ROW LEVEL SECURITY;")
        print("✓ RLS disabled on voice_agents")

        # Also grant access to the anon and authenticated roles
        await conn.execute("GRANT ALL ON voice_agents TO anon;")
        await conn.execute("GRANT ALL ON voice_agents TO authenticated;")
        await conn.execute("GRANT USAGE, SELECT ON SEQUENCE voice_agents_id_seq TO anon;")
        await conn.execute("GRANT USAGE, SELECT ON SEQUENCE voice_agents_id_seq TO authenticated;")
        print("✓ Granted access to anon and authenticated roles")

    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
