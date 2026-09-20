from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.db import pool

router = APIRouter()

class CompanyIn(BaseModel):
    name: str
    code: str = Field(..., description="employeeNo que cargarás en el teclado")
    pin: Optional[str] = Field(None, description="PIN compartido (PoC)")


class CompanyPatch(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    pin: Optional[str] = None
    active: Optional[bool] = None

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


@router.patch("/id/{company_id}")
async def update_company(company_id: int, body: CompanyPatch):
    fields = []
    params = []
    payload = body.model_dump(exclude_unset=True)

    if "name" in payload:
        fields.append("name = %s")
        params.append(payload["name"])
    if "code" in payload:
        fields.append("code = %s")
        params.append(payload["code"])
    if "pin" in payload:
        fields.append("pin = %s")
        params.append(payload["pin"])
    if "active" in payload:
        fields.append("active = %s")
        params.append(payload["active"])

    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    fields.append("updated_at = now()")
    params.append(company_id)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
                    f"""
                    UPDATE public.company
                       SET {", ".join(fields)}
                     WHERE id = %s
                 RETURNING id, name, code, pin, active
                    """,
                    tuple(params),
                )
                row = await cur.fetchone()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Error actualizando empresa: {e}")

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    return {
        "ok": True,
        "item": {
            "id": row[0],
            "name": row[1],
            "code": row[2],
            "pin": row[3],
            "active": row[4],
        },
    }


@router.delete("/id/{company_id}")
async def delete_company(company_id: int):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM public.water_dispatch WHERE company_id = %s) AS dispatches,
                  (SELECT COUNT(*) FROM public.wallet_movement WHERE company_id = %s) AS wallet_movements,
                  (SELECT COUNT(*) FROM public.water_payment WHERE company_id = %s) AS payments,
                  (SELECT COUNT(*) FROM public.company_wallet WHERE company_id = %s) AS wallets
                """,
                (company_id, company_id, company_id, company_id),
            )
            counts = await cur.fetchone()

            dispatches = int(counts[0] or 0)
            wallet_movements = int(counts[1] or 0)
            payments = int(counts[2] or 0)
            wallets = int(counts[3] or 0)

            if any(v > 0 for v in (dispatches, wallet_movements, payments, wallets)):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "La empresa tiene historial o datos financieros asociados. Desactivala en lugar de eliminarla.",
                        "dispatches": dispatches,
                        "wallet_movements": wallet_movements,
                        "payments": payments,
                        "wallets": wallets,
                    },
                )

            await cur.execute(
                "DELETE FROM public.company WHERE id = %s RETURNING id",
                (company_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    return {"ok": True, "id": company_id}
