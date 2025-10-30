# app/db.py
import os
from psycopg_pool import AsyncConnectionPool

DSN = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
if not DSN:
    raise RuntimeError("Faltan las envs DATABASE_URL o SUPABASE_DB_URL")

# Parámetros de conexión (render-friendly)
CONNECT_KW = dict(
    connect_timeout=5,
    keepalives=1,
    keepalives_idle=30,
    keepalives_interval=10,
    keepalives_count=3,
    options="-c statement_timeout=60000",
)

# Pool ASÍNCRONO (¡importante!)
pool = AsyncConnectionPool(
    conninfo=DSN,
    min_size=int(os.getenv("DB_MIN_CONN", "1")),
    max_size=int(os.getenv("DB_MAX_CONN", "8")),
    max_idle=int(os.getenv("DB_MAX_IDLE", "30")),
    max_lifetime=int(os.getenv("DB_MAX_LIFETIME", "3600")),
    timeout=int(os.getenv("DB_POOL_TIMEOUT", "5")),
    kwargs=CONNECT_KW,
)

# Si querés usarlo como helper:
def get_conn():
    # usar así:  async with get_conn() as conn:
    return pool.connection()

# Ping opcional (lo podés usar en /health si querés)
async def ping() -> bool:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
            row = await cur.fetchone()
            return bool(row and row[0] == 1)
