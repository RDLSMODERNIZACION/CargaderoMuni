from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import pool

router = APIRouter()

class StartDispatchIn(BaseModel):
    station_id: str = Field(..., example="PALACIO")
    company_code: str = Field(..., example="EMP001")
    photo_path: Optional[str] = Field(None, example="https://storage/snap.jpg")
    note: Optional[str] = "despacho iniciado manual"

class SetLitersIn(BaseModel):
    liters: float = Field(..., ge=0)

@router.post("/dispatch/start")
async def start_dispatch(body: StartDispatchIn):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # empresa
            await cur.execute(
                "SELECT id FROM public.company WHERE code=%s AND active",
                (body.company_code,),
            )
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="company not found or inactive")
            company_id = int(r[0])
            # crear despacho
            await cur.execute(
                """
                INSERT INTO public.water_dispatch (station_id, company_id, photo_path, note)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (body.station_id, company_id, body.photo_path, body.note),
            )
            row = await cur.fetchone()
            return {"ok": True, "id": int(row[0])}

@router.post("/dispatch/{dispatch_id}/liters")
async def set_liters(dispatch_id: int, body: SetLitersIn):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE public.water_dispatch SET liters=%s WHERE id=%s RETURNING id",
                (body.liters, dispatch_id),
            )
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="dispatch not found")
            return {"ok": True, "id": dispatch_id, "liters": body.liters}

@router.get("/dispatch/recent")
async def recent(station_id: str, limit: int = 20):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT wd.id, wd.ts, wd.station_id, wd.liters, wd.photo_path, wd.note,
                       c.id AS company_id, c.name AS company, c.code
                FROM public.water_dispatch wd
                LEFT JOIN public.company c ON c.id = wd.company_id
                WHERE wd.station_id=%s
                ORDER BY wd.ts DESC
                LIMIT %s
                """,
                (station_id, limit),
            )
            rows = await cur.fetchall()
            out = []
            for r in rows:
                out.append({
                    "id": r[0], "ts": r[1], "station_id": r[2],
                    "liters": r[3], "photo_path": r[4], "note": r[5],
                    "company_id": r[6], "company": r[7], "company_code": r[8],
                })
            return {"ok": True, "items": out}
