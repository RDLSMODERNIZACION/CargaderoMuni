# app/db.py
import os
from psycopg_pool import ConnectionPool

DSN = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
if not DSN:
    raise RuntimeError("Faltan las envs DATABASE_URL o SUPABASE_DB_URL")

pool = ConnectionPool(
    conninfo=DSN,
    min_size=1,
    max_size=8,
    max_idle=30,
    max_lifetime=3600,
    timeout=5,
    kwargs=dict(
        connect_timeout=5,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
        options="-c statement_timeout=60000",
    ),
)

def get_conn():
    return pool.connection()
