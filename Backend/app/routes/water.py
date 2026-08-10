from __future__ import annotations

import os
import time
import uuid
from typing import Optional, Any

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.db import pool

router = APIRouter()

# =========================
# ENV
# =========================
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE", "")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "cargadero")


def _public_url(object_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{object_path}"


async def _upload_bytes_to_supabase(
    *,
    data: bytes,
    content_type: str,
    object_path: str,
) -> str:
    """
    Sube bytes a Supabase Storage usando service role y devuelve URL pública.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
        raise HTTPException(
            status_code=500,
            detail="Supabase env vars missing (SUPABASE_URL/SUPABASE_SERVICE_ROLE)",
        )

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
            detail={
                "supabase_status": r.status_code,
                "supabase_body": r.text,
            },
        )

    return _public_url(object_path)


def _normalize_photo_paths(value: Any, fallback_photo: Optional[str] = None) -> list[str]:
    """
    Normaliza photo_paths para devolver siempre una lista.
    Sirve para filas viejas o valores NULL.
    """
    if isinstance(value, list):
        return value

    if isinstance(value, tuple):
        return list(value)

    if isinstance(value, str) and value.strip():
        # Por si alguna vez vino guardado como string simple
        return [value]

    if fallback_photo:
        return [fallback_photo]

    return []


# =========================
# Schemas
# =========================
class StartDispatchIn(BaseModel):
    station_id: str = Field(..., examples=["1"])
    company_code: str = Field(..., examples=["1"])
    photo_path: Optional[str] = Field(None, examples=["https://storage/snap.jpg"])
    note: Optional[str] = Field(
        "despacho iniciado manual",
        examples=["PIN OK + foto camión"],
    )


class SetLitersIn(BaseModel):
    liters: float = Field(..., ge=0)


# =========================
# DISPATCH START
# =========================
@router.post("/dispatch/start")
async def start_dispatch(request: Request):
    """
    Endpoint unificado.

    Modo JSON:
      {
        "station_id": "2",
        "company_code": "1",
        "photo_path": "https://...",
        "note": "..."
      }

    Modo multipart/form-data:
      station_id
      company_code
      note
      suffix
      file
      file1
      file2
      file3
      file4

    Guarda:
      - photo_path: primera foto recibida
      - photo_paths: lista JSONB con todas las fotos recibidas
    """
    ct = (request.headers.get("content-type") or "").lower()

    # ==================================================
    # MODO MULTIPART: 0..N fotos
    # ==================================================
    if "multipart/form-data" in ct:
        form = await request.form()

        station_id = str(form.get("station_id") or "").strip()
        company_code = str(form.get("company_code") or "").strip()
        note = str(form.get("note") or "despacho iniciado por trigger").strip()
        suffix = str(form.get("suffix") or "start").strip()

        if not station_id or not company_code:
            raise HTTPException(
                status_code=422,
                detail="station_id and company_code are required (multipart)",
            )

        # Buscar empresa activa por code.
        # IMPORTANTE:
        # Node-RED manda company_code desde employeeNoString del Hikvision.
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT id
                    FROM public.company
                    WHERE code = %s
                      AND active
                    """,
                    (company_code,),
                )
                r = await cur.fetchone()

                if not r:
                    raise HTTPException(
                        status_code=404,
                        detail="company not found or inactive",
                    )

                company_id = int(r[0])

        # Aceptamos varios nombres de archivo desde Node-RED.
        # Tu flujo manda:
        #   file1 = teclado
        #   file2 = camara_2
        #   file3 = camara_3
        upload_fields = ["file", "file1", "file2", "file3", "file4"]
        uploaded_urls: list[str] = []

        for idx, field in enumerate(upload_fields, start=1):
            file_obj = form.get(field)

            if file_obj is None or not hasattr(file_obj, "read"):
                continue

            upload: UploadFile = file_obj  # type: ignore

            content_type = (upload.content_type or "").lower()

            if content_type not in ("image/jpeg", "image/jpg", "image/png"):
                raise HTTPException(
                    status_code=415,
                    detail=f"Unsupported content-type in {field}: {upload.content_type}",
                )

            data = await upload.read()

            if not data or len(data) < 1000:
                raise HTTPException(
                    status_code=400,
                    detail=f"{field} empty or too small",
                )

            ext = ".png" if content_type == "image/png" else ".jpg"
            ts = int(time.time())

            safe_station = station_id.upper().replace(" ", "_")
            safe_suffix = suffix.replace(" ", "_")
            object_path = (
                f"photos/dispatch_{safe_station}/"
                f"{safe_suffix}_{field}_{idx}_{ts}_{uuid.uuid4().hex[:8]}{ext}"
            )

            public_url = await _upload_bytes_to_supabase(
                data=data,
                content_type=content_type,
                object_path=object_path,
            )

            uploaded_urls.append(public_url)

        # Primera foto para compatibilidad con frontend viejo.
        main_photo = uploaded_urls[0] if uploaded_urls else None

        # Crear despacho guardando TODAS las fotos en photo_paths.
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO public.water_dispatch
                        (station_id, company_id, photo_path, photo_paths, note)
                    VALUES
                        (%s, %s, %s, %s, %s)
                    RETURNING id, ts
                    """,
                    (
                        station_id,
                        company_id,
                        main_photo,
                        Jsonb(uploaded_urls),
                        note,
                    ),
                )

                row = await cur.fetchone()

        return JSONResponse(
            {
                "ok": True,
                "id": int(row[0]),
                "ts": row[1].isoformat() if row and row[1] else None,
                "station_id": station_id,
                "company_code": company_code,
                "company_id": company_id,
                "photo_path": main_photo,
                "photo_paths": uploaded_urls,
                "note": note,
            }
        )

    # ==================================================
    # MODO JSON: sin foto o con una URL
    # ==================================================
    body = await request.json()
    payload = StartDispatchIn.model_validate(body)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id
                FROM public.company
                WHERE code = %s
                  AND active
                """,
                (payload.company_code,),
            )

            r = await cur.fetchone()

            if not r:
                raise HTTPException(
                    status_code=404,
                    detail="company not found or inactive",
                )

            company_id = int(r[0])

            photo_paths = [payload.photo_path] if payload.photo_path else []

            await cur.execute(
                """
                INSERT INTO public.water_dispatch
                    (station_id, company_id, photo_path, photo_paths, note)
                VALUES
                    (%s, %s, %s, %s, %s)
                RETURNING id, ts
                """,
                (
                    payload.station_id,
                    company_id,
                    payload.photo_path,
                    Jsonb(photo_paths),
                    payload.note,
                ),
            )

            row = await cur.fetchone()

    return {
        "ok": True,
        "id": int(row[0]),
        "ts": row[1].isoformat() if row and row[1] else None,
        "station_id": payload.station_id,
        "company_code": payload.company_code,
        "company_id": company_id,
        "photo_path": payload.photo_path,
        "photo_paths": photo_paths,
        "note": payload.note,
    }


# =========================
# LITERS
# =========================
@router.post("/dispatch/{dispatch_id}/liters")
async def set_liters(dispatch_id: int, body: SetLitersIn):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.water_dispatch
                SET liters = %s
                WHERE id = %s
                RETURNING id
                """,
                (body.liters, dispatch_id),
            )

            r = await cur.fetchone()

            if not r:
                raise HTTPException(
                    status_code=404,
                    detail="dispatch not found",
                )

    return {
        "ok": True,
        "id": dispatch_id,
        "liters": body.liters,
    }


# =========================
# RECENT
# =========================
@router.get("/dispatch/recent")
async def recent(limit: int = 20, station_id: Optional[str] = None):
    """
    Trae despachos recientes.

    Ejemplos:
      /water/dispatch/recent?limit=200
      /water/dispatch/recent?station_id=2&limit=200

    Devuelve:
      - photo_path: foto principal
      - photo_paths: todas las fotos guardadas
    """
    limit = max(1, min(int(limit), 500))

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if station_id:
                await cur.execute(
                    """
                    SELECT
                        wd.id,
                        wd.ts,
                        wd.station_id,
                        wd.liters,
                        wd.flow_l_min,
                        wd.photo_path,
                        wd.photo_paths,
                        wd.note,
                        c.id AS company_id,
                        c.name AS company_name,
                        c.code AS company_code
                    FROM public.water_dispatch wd
                    LEFT JOIN public.company c
                        ON c.id = wd.company_id
                    WHERE wd.station_id = %s
                    ORDER BY wd.ts DESC
                    LIMIT %s
                    """,
                    (station_id, limit),
                )
            else:
                await cur.execute(
                    """
                    SELECT
                        wd.id,
                        wd.ts,
                        wd.station_id,
                        wd.liters,
                        wd.flow_l_min,
                        wd.photo_path,
                        wd.photo_paths,
                        wd.note,
                        c.id AS company_id,
                        c.name AS company_name,
                        c.code AS company_code
                    FROM public.water_dispatch wd
                    LEFT JOIN public.company c
                        ON c.id = wd.company_id
                    ORDER BY wd.ts DESC
                    LIMIT %s
                    """,
                    (limit,),
                )

            rows = await cur.fetchall()

    items = []

    for r in rows:
        photo_path = r[5]
        photo_paths = _normalize_photo_paths(r[6], fallback_photo=photo_path)

        items.append(
            {
                "id": r[0],
                "ts": r[1].isoformat() if r[1] else None,
                "station_id": r[2],
                "liters": r[3],
                "flow_l_min": r[4],
                "photo_path": photo_path,
                "photo_paths": photo_paths,
                "note": r[7],
                "company_id": r[8],
                "company_name": r[9],
                "company_code": r[10],
            }
        )

    return {
        "ok": True,
        "items": items,
    }


# =========================
# ATTACH PHOTO TO EXISTING DISPATCH
# =========================
@router.post("/dispatch/{dispatch_id}/photo")
async def attach_photo(dispatch_id: int, request: Request):
    """
    Adjunta/actualiza una foto para un despacho existente.

    Espera multipart/form-data con:
      file   jpg/png requerido
      suffix opcional, default "truck"

    Actualiza:
      - photo_path: última foto cargada
      - photo_paths: agrega la nueva URL al arreglo existente
    """
    ct = (request.headers.get("content-type") or "").lower()

    if "multipart/form-data" not in ct:
        raise HTTPException(
            status_code=415,
            detail="Expected multipart/form-data",
        )

    form = await request.form()
    suffix = str(form.get("suffix") or "truck").strip()

    file_obj = form.get("file")

    if file_obj is None or not hasattr(file_obj, "read"):
        raise HTTPException(
            status_code=422,
            detail="file is required (multipart)",
        )

    upload: UploadFile = file_obj  # type: ignore

    content_type = (upload.content_type or "").lower()

    if content_type not in ("image/jpeg", "image/jpg", "image/png"):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content-type: {upload.content_type}",
        )

    data = await upload.read()

    if not data or len(data) < 1000:
        raise HTTPException(
            status_code=400,
            detail="File empty or too small",
        )

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT station_id
                FROM public.water_dispatch
                WHERE id = %s
                """,
                (dispatch_id,),
            )

            row = await cur.fetchone()

            if not row:
                raise HTTPException(
                    status_code=404,
                    detail="dispatch not found",
                )

            station_id = row[0] or "UNKNOWN"

    ext = ".png" if content_type == "image/png" else ".jpg"
    ts = int(time.time())

    safe_station = str(station_id).upper().replace(" ", "_")
    safe_suffix = suffix.replace(" ", "_")

    object_path = (
        f"photos/dispatch_{safe_station}/"
        f"{safe_suffix}_{ts}_{uuid.uuid4().hex[:8]}{ext}"
    )

    public_url = await _upload_bytes_to_supabase(
        data=data,
        content_type=content_type,
        object_path=object_path,
    )

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.water_dispatch
                SET
                    photo_path = %s,
                    photo_paths = COALESCE(photo_paths, '[]'::jsonb) || %s
                WHERE id = %s
                RETURNING id
                """,
                (
                    public_url,
                    Jsonb([public_url]),
                    dispatch_id,
                ),
            )

            r = await cur.fetchone()

            if not r:
                raise HTTPException(
                    status_code=404,
                    detail="dispatch not found",
                )

    return JSONResponse(
        {
            "ok": True,
            "dispatch_id": dispatch_id,
            "photo_path": public_url,
            "photo_paths_added": [public_url],
        }
    )
