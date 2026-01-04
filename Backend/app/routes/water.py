from __future__ import annotations

import os
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.db import pool

router = APIRouter()

# =========================
# ENV (usa tus nombres reales)
# =========================
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE", "")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "cargadero")


def _public_url(object_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{object_path}"


async def _upload_bytes_to_supabase(*, data: bytes, content_type: str, object_path: str) -> str:
    """
    Sube bytes (jpg/png) a Supabase Storage usando service role y devuelve URL pública.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
        raise HTTPException(status_code=500, detail="Supabase env vars missing (SUPABASE_URL/SUPABASE_SERVICE_ROLE)")

    upload_url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{object_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(upload_url, content=data, headers=headers)

    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail={"supabase_status": r.status_code, "supabase_body": r.text},
        )

    return _public_url(object_path)


# =========================
# Schemas (JSON mode)
# =========================
class StartDispatchIn(BaseModel):
    station_id: str = Field(..., example="PALACIO")
    company_code: str = Field(..., example="EMP001")
    photo_path: Optional[str] = Field(None, example="https://storage/snap.jpg")
    note: Optional[str] = "despacho iniciado manual"


class SetLitersIn(BaseModel):
    liters: float = Field(..., ge=0)


# =========================
# DISPATCH START (UNIFICADO)
# =========================
@router.post("/dispatch/start")
async def start_dispatch(request: Request):
    """
    Endpoint UNIFICADO:
    - Si viene JSON: crea water_dispatch (usa photo_path si viene).
    - Si viene multipart/form-data: recibe file, sube a Supabase y crea water_dispatch con photo_path=URL pública.

    JSON body:
      { station_id, company_code, photo_path?, note? }

    Multipart fields:
      file (jpg/png) [required]
      station_id (required)
      company_code (required)
      note (optional)
      suffix (optional, default "start")
    """
    ct = (request.headers.get("content-type") or "").lower()

    # -------------------------
    # MODO MULTIPART (con foto)
    # -------------------------
    if "multipart/form-data" in ct:
        form = await request.form()

        # required fields
        station_id = (form.get("station_id") or "").strip()
        company_code = (form.get("company_code") or "").strip()
        note = (form.get("note") or "despacho iniciado por trigger").strip()
        suffix = (form.get("suffix") or "start").strip()

        file_obj = form.get("file")
        if not station_id or not company_code:
            raise HTTPException(status_code=422, detail="station_id and company_code are required (multipart)")
        if file_obj is None or not hasattr(file_obj, "read"):
            raise HTTPException(status_code=422, detail="file is required (multipart)")

        upload: UploadFile = file_obj  # type: ignore

        content_type = (upload.content_type or "").lower()
        if content_type not in ("image/jpeg", "image/jpg", "image/png"):
            raise HTTPException(status_code=415, detail=f"Unsupported content-type: {upload.content_type}")

        data = await upload.read()
        if not data or len(data) < 1000:
            raise HTTPException(status_code=400, detail="File empty or too small")

        ext = ".png" if content_type == "image/png" else ".jpg"
        ts = int(time.time())
        safe_station = station_id.upper().replace(" ", "_")
        object_path = f"photos/dispatch_{safe_station}/{suffix}_{ts}_{uuid.uuid4().hex[:8]}{ext}"

        # empresa
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM public.company WHERE code=%s AND active",
                    (company_code,),
                )
                r = await cur.fetchone()
                if not r:
                    raise HTTPException(status_code=404, detail="company not found or inactive")
                company_id = int(r[0])

        # subir foto
        public_url = await _upload_bytes_to_supabase(
            data=data,
            content_type=content_type,
            object_path=object_path,
        )

        # crear despacho con photo_path real
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO public.water_dispatch (station_id, company_id, photo_path, note)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, ts
                    """,
                    (station_id, company_id, public_url, note),
                )
                row = await cur.fetchone()
                return JSONResponse(
                    {
                        "ok": True,
                        "id": int(row[0]),
                        "ts": row[1].isoformat() if row and row[1] else None,
                        "station_id": station_id,
                        "company_code": company_code,
                        "photo_path": public_url,
                    }
                )

    # -------------------------
    # MODO JSON (sin foto o con URL)
    # -------------------------
    body = await request.json()
    payload = StartDispatchIn.model_validate(body)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # empresa
            await cur.execute(
                "SELECT id FROM public.company WHERE code=%s AND active",
                (payload.company_code,),
            )
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="company not found or inactive")
            company_id = int(r[0])

            # crear despacho (con photo_path si ya te lo pasan)
            await cur.execute(
                """
                INSERT INTO public.water_dispatch (station_id, company_id, photo_path, note)
                VALUES (%s, %s, %s, %s)
                RETURNING id, ts
                """,
                (payload.station_id, company_id, payload.photo_path, payload.note),
            )
            row = await cur.fetchone()
            return {
                "ok": True,
                "id": int(row[0]),
                "ts": row[1].isoformat() if row and row[1] else None,
                "station_id": payload.station_id,
                "company_code": payload.company_code,
                "photo_path": payload.photo_path,
            }


# =========================
# LITERS
# =========================
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


# =========================
# RECENT
# =========================
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
                out.append(
                    {
                        "id": r[0],
                        "ts": r[1],
                        "station_id": r[2],
                        "liters": r[3],
                        "photo_path": r[4],
                        "note": r[5],
                        "company_id": r[6],
                        "company": r[7],
                        "company_code": r[8],
                    }
                )
            return {"ok": True, "items": out}
