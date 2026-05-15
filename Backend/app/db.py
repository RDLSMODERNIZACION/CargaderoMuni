# app/db.py
import os

from psycopg_pool import AsyncConnectionPool

DSN = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")

if not DSN:
    raise RuntimeError("Faltan las envs DATABASE_URL o SUPABASE_DB_URL")

# Parámetros de conexión
CONNECT_KW = dict(
    connect_timeout=5,
    keepalives=1,
    keepalives_idle=30,
    keepalives_interval=10,
    keepalives_count=3,
    options="-c statement_timeout=60000",
)

# IMPORTANTE:
# open=False evita que el pool intente abrirse durante el import.
# Se abre después desde main.py, cuando FastAPI ya tiene loop async.
pool = AsyncConnectionPool(
    conninfo=DSN,
    min_size=int(os.getenv("DB_MIN_CONN", "1")),
    max_size=int(os.getenv("DB_MAX_CONN", "8")),
    max_idle=int(os.getenv("DB_MAX_IDLE", "30")),
    max_lifetime=int(os.getenv("DB_MAX_LIFETIME", "3600")),
    timeout=int(os.getenv("DB_POOL_TIMEOUT", "5")),
    kwargs=CONNECT_KW,
    open=False,
)


def get_conn():
    # usar así: async with get_conn() as conn:
    return pool.connection()


async def open_pool() -> None:
    """
    Se llama desde el startup/lifespan de FastAPI.
    """
    await pool.open(wait=True)


async def close_pool() -> None:
    """
    Se llama cuando FastAPI apaga la app.
    """
    await pool.close()


async def ping() -> bool:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
            row = await cur.fetchone()
            return bool(row and row[0] == 1)
