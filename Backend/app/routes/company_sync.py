# app/routes/company_sync.py
from fastapi import APIRouter, HTTPException
from app.db import pool

router = APIRouter()

@router.get("/hik-users")
async def list_hik_users():
    """
    Devuelve todas las companies ACTIVAS con PIN no nulo:
    [{ employeeNo, name, password }, ...]
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT name, code, pin
                FROM public.company
                WHERE active
                  AND pin IS NOT NULL
                  AND pin <> ''
                ORDER BY code ASC
                LIMIT 2000
            """)
            rows = await cur.fetchall()

    items = [{"employeeNo": r[1], "name": r[0], "password": str(r[2])} for r in rows]
    return {"ok": True, "count": len(items), "items": items}

@router.get("/{code}/hik-user")
async def get_hik_user(code: str):
    """
    Devuelve una credencial por code (employeeNo):
    { employeeNo, name, password }
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT name, code, pin, active
                FROM public.company
                WHERE code = %s
            """, (code,))
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="company not found")
    if not row[3]:
        raise HTTPException(status_code=404, detail="company inactive")

    item = {"employeeNo": row[1], "name": row[0], "password": (None if row[2] is None else str(row[2]))}
    return {"ok": True, "item": item}
