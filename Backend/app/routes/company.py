from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.db import pool

router = APIRouter()

class CompanyIn(BaseModel):
    name: str
    code: str = Field(..., description="employeeNo que cargarás en el teclado")
    pin: Optional[str] = Field(None, description="PIN compartido (PoC)")

@router.post("")
async def create_or_update_company(body: CompanyIn):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.company (name, code, pin, active)
                VALUES (%s, %s, %s, TRUE)
                ON CONFLICT (code) DO UPDATE SET
                  name = EXCLUDED.name,
                  pin  = EXCLUDED.pin,
                  updated_at = now(),
                  active = TRUE
                RETURNING id
                """,
                (body.name, body.code, body.pin),
            )
            row = await cur.fetchone()
            return {"ok": True, "id": int(row[0])}

@router.get("")
async def list_companies(active: bool = True):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if active:
                await cur.execute("SELECT id, name, code, pin, active FROM public.company WHERE active ORDER BY id")
            else:
                await cur.execute("SELECT id, name, code, pin, active FROM public.company ORDER BY id")
            rows = await cur.fetchall()
            return {"ok": True, "items": [
                {"id": r[0], "name": r[1], "code": r[2], "pin": r[3], "active": r[4]} for r in rows
            ]}

@router.post("/{code}/deactivate")
async def deactivate_company(code: str):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE public.company SET active=FALSE WHERE code=%s RETURNING id", (code,))
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="company not found")
            return {"ok": True}
