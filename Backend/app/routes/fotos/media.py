from __future__ import annotations

import os
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/fotos/media", tags=["fotos"])

# ===== ENV (adaptado a tus variables reales) =====
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE", "")
SUPABASE_BUCKET = os.getenv("STORAGE_BUCKET", "cargadero")

# ===== Helpers =====
def public_url(object_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{object_path}"

# ===== Endpoint =====
@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    station_id: Optional[str] = Form(None),
    kind: str = Form("dispatch"),   # dispatch | access | anpr
    suffix: str = Form("start"),    # start | end | event
    folder: str = Form("photos"),
):
    """
    Recibe una imagen (multipart), la sube a Supabase Storage
    y devuelve la URL pública.
    """

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env vars missing")

    content_type = (file.content_type or "").lower()
    if content_type not in ("image/jpeg", "image/jpg", "image/png"):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content-type: {file.content_type}"
        )

    data = await file.read()
    if not data or len(data) < 1000:
        raise HTTPException(status_code=400, detail="File empty or too small")

    ext = ".jpg" if content_type != "image/png" else ".png"

    ts = int(time.time())
    safe_station = (station_id or "unknown").upper().replace(" ", "_")

    object_path = (
        f"{folder.rstrip('/')}/"
        f"{kind}_{safe_station}/"
        f"{suffix}_{ts}_{uuid.uuid4().hex[:8]}{ext}"
    )

    upload_url = (
        f"{SUPABASE_URL}/storage/v1/object/"
        f"{SUPABASE_BUCKET}/{object_path}"
    )

    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(upload_url, content=data, headers=headers)

    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail={
                "supabase_status": r.status_code,
                "supabase_body": r.text,
            },
        )

    return JSONResponse(
        {
            "ok": True,
            "bucket": SUPABASE_BUCKET,
            "path": object_path,
            "public_url": public_url(object_path),
            "bytes": len(data),
            "content_type": content_type,
        }
    )
