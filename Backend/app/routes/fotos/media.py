from __future__ import annotations

import os
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

from app.db import pool

router = APIRouter(prefix="/fotos/media", tags=["fotos"])

# ===== ENV =====
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


@router.post("/dispatch/{dispatch_id}/truck")
async def upload_truck_photo_for_dispatch(
    dispatch_id: int,
    file: UploadFile = File(...),
    station_id: Optional[str] = Form(None),
    suffix: str = Form("truck"),
):
    """
    ✅ Adjunta foto del camión a un despacho EXISTENTE.
    - Sube a Supabase Storage
    - Actualiza water_dispatch.photo_path
    - Devuelve la URL pública
    """
    content_type = (file.content_type or "").lower()
    if content_type not in ("image/jpeg", "image/jpg", "image/png"):
        raise HTTPException(status_code=415, detail=f"Unsupported content-type: {file.content_type}")

    data = await file.read()
    if not data or len(data) < 1000:
        raise HTTPException(status_code=400, detail="File empty or too small")

    # Buscar station_id si no lo mandan
    if not station_id:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT station_id FROM public.water_dispatch WHERE id=%s", (dispatch_id,))
                row = await cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="dispatch not found")
                station_id = (row[0] or "UNKNOWN")

    safe_station = (station_id or "UNKNOWN").upper().replace(" ", "_")
    ts = int(time.time())
    ext = ".png" if content_type == "image/png" else ".jpg"

    object_path = f"photos/dispatch_{safe_station}/{suffix}_{ts}_{uuid.uuid4().hex[:8]}{ext}"

    public_url = await _upload_bytes_to_supabase(
        data=data,
        content_type=content_type,
        object_path=object_path,
    )

    # Update dispatch.photo_path
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE public.water_dispatch SET photo_path=%s WHERE id=%s RETURNING id",
                (public_url, dispatch_id),
            )
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="dispatch not found")

    return JSONResponse({"ok": True, "dispatch_id": dispatch_id, "photo_path": public_url})
