from __future__ import annotations

import os
import time
import uuid
from datetime import datetime
from typing import Optional, Any

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.db import pool
from app.services.vehicle_ai import analyze_dispatch_vehicle

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
    company_code: Optional[str] = Field(None, examples=["1"])
    photo_path: Optional[str] = Field(None, examples=["https://storage/snap.jpg"])
    note: Optional[str] = Field(
        "despacho iniciado manual",
        examples=["PIN OK + foto camión"],
    )


class SetLitersIn(BaseModel):
    liters: float = Field(..., ge=0)


class AdminDispatchCreate(BaseModel):
    station_id: str
    company_id: int
    liters: Optional[float] = Field(None, ge=0)
    flow_l_min: Optional[float] = Field(None, ge=0)
    note: Optional[str] = None
    ts: Optional[datetime] = None


class AdminDispatchPatch(BaseModel):
    station_id: Optional[str] = None
    company_id: Optional[int] = None
    liters: Optional[float] = Field(None, ge=0)
    flow_l_min: Optional[float] = Field(None, ge=0)
    note: Optional[str] = None
    ts: Optional[datetime] = None


# =========================
# DISPATCH START
# =========================
@router.post("/dispatch/start")
async def start_dispatch(request: Request, background_tasks: BackgroundTasks):
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
      file1..fileN (cantidad dinámica)

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

        if not station_id:
            raise HTTPException(
                status_code=422,
                detail="station_id is required (multipart)",
            )

        # company_code es opcional:
        # - con PIN: se resuelve empresa activa por code;
        # - arranque manual de bomba: queda company_id = NULL.
        company_id = None
        if company_code:
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

        # Aceptamos cantidad dinámica de archivos desde Node-RED.
        # Cualquier campo multipart cuyo valor sea un UploadFile es procesado.
        uploaded_urls: list[str] = []

        upload_items = [
            (field, value)
            for field, value in form.multi_items()
            if hasattr(value, "read")
        ]

        for idx, (field, file_obj) in enumerate(upload_items, start=1):
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

        dispatch_id = int(row[0])
        if uploaded_urls:
            background_tasks.add_task(analyze_dispatch_vehicle, dispatch_id)
        ai_analysis = {"status": "queued"} if uploaded_urls else {"status": "no_photos"}

        return JSONResponse(
            {
                "ok": True,
                "id": dispatch_id,
                "ts": row[1].isoformat() if row and row[1] else None,
                "station_id": station_id,
                "company_code": company_code,
                "company_id": company_id,
                "photo_path": main_photo,
                "photo_paths": uploaded_urls,
                "note": note,
                "ai_vehicle_analysis": ai_analysis,
            }
        )

    # ==================================================
    # MODO JSON: sin foto o con una URL
    # ==================================================
    body = await request.json()
    payload = StartDispatchIn.model_validate(body)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            company_id = None
            company_code = (payload.company_code or "").strip()

            if company_code:
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

    dispatch_id = int(row[0])
    if payload.photo_path:
        background_tasks.add_task(analyze_dispatch_vehicle, dispatch_id)

    return {
        "ok": True,
        "id": dispatch_id,
        "ts": row[1].isoformat() if row and row[1] else None,
        "station_id": payload.station_id,
        "company_code": company_code or None,
        "company_id": company_id,
        "photo_path": payload.photo_path,
        "photo_paths": photo_paths,
        "note": payload.note,
        "ai_vehicle_analysis": {"status": "queued"} if payload.photo_path else {"status": "no_photos"},
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
                        wd.ai_vehicle_analysis,
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
                        wd.ai_vehicle_analysis,
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
                "ai_vehicle_analysis": r[8] or {},
                "company_id": r[9],
                "company_name": r[10],
                "company_code": r[11],
            }
        )

    return {
        "ok": True,
        "items": items,
    }


# =========================
# DISPATCH DETAIL
# =========================
@router.get("/dispatch/{dispatch_id}")
async def get_dispatch(dispatch_id: int):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    wd.id,
                    wd.ts,
                    wd.station_id,
                    s.name AS station_name,
                    wd.liters,
                    wd.flow_l_min,
                    wd.photo_path,
                    wd.photo_paths,
                    wd.note,
                    wd.ai_vehicle_analysis,
                    wd.billing_status,
                    wd.price_per_m3,
                    wd.amount,
                    wd.max_affordable_liters,
                    wd.debited_at,
                    c.id AS company_id,
                    c.name AS company_name,
                    c.code AS company_code
                FROM public.water_dispatch wd
                LEFT JOIN public.company c ON c.id = wd.company_id
                LEFT JOIN public.station s ON s.id = wd.station_id
                WHERE wd.id = %s
                """,
                (dispatch_id,),
            )
            r = await cur.fetchone()

    if not r:
        raise HTTPException(status_code=404, detail="dispatch not found")

    photo_path = r[6]
    photo_paths = _normalize_photo_paths(r[7], fallback_photo=photo_path)

    return {
        "ok": True,
        "item": {
            "id": r[0],
            "ts": r[1].isoformat() if r[1] else None,
            "station_id": r[2],
            "station_name": r[3],
            "liters": r[4],
            "flow_l_min": r[5],
            "photo_path": photo_path,
            "photo_paths": photo_paths,
            "note": r[8],
            "ai_vehicle_analysis": r[9] or {},
            "billing_status": r[10],
            "price_per_m3": r[11],
            "amount": r[12],
            "max_affordable_liters": r[13],
            "debited_at": r[14].isoformat() if r[14] else None,
            "company_id": r[15],
            "company_name": r[16],
            "company_code": r[17],
        },
    }


# =========================
# ADMIN DISPATCH CRUD
# =========================
@router.post("/dispatch/admin")
async def create_dispatch_admin(body: AdminDispatchCreate):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM public.station WHERE id = %s",
                (body.station_id,),
            )
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="station not found")

            await cur.execute(
                "SELECT 1 FROM public.company WHERE id = %s",
                (body.company_id,),
            )
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="company not found")

            await cur.execute(
                """
                INSERT INTO public.water_dispatch
                    (station_id, company_id, liters, flow_l_min, note, ts)
                VALUES
                    (%s, %s, %s, %s, %s, COALESCE(%s, now()))
                RETURNING id, ts
                """,
                (
                    body.station_id,
                    body.company_id,
                    body.liters,
                    body.flow_l_min,
                    body.note or "despacho creado manualmente",
                    body.ts,
                ),
            )
            row = await cur.fetchone()

    return {
        "ok": True,
        "id": int(row[0]),
        "ts": row[1].isoformat() if row[1] else None,
    }


@router.patch("/dispatch/{dispatch_id}")
async def update_dispatch_admin(dispatch_id: int, body: AdminDispatchPatch):
    updates = []
    params = []

    payload = body.model_dump(exclude_unset=True)

    if "station_id" in payload:
        updates.append("station_id = %s")
        params.append(payload["station_id"])
    if "company_id" in payload:
        updates.append("company_id = %s")
        params.append(payload["company_id"])
    if "liters" in payload:
        updates.append("liters = %s")
        params.append(payload["liters"])
    if "flow_l_min" in payload:
        updates.append("flow_l_min = %s")
        params.append(payload["flow_l_min"])
    if "note" in payload:
        updates.append("note = %s")
        params.append(payload["note"])
    if "ts" in payload:
        updates.append("ts = %s")
        params.append(payload["ts"])

    if not updates:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if "station_id" in payload:
                await cur.execute(
                    "SELECT 1 FROM public.station WHERE id = %s",
                    (payload["station_id"],),
                )
                if not await cur.fetchone():
                    raise HTTPException(status_code=404, detail="station not found")

            if "company_id" in payload:
                await cur.execute(
                    "SELECT 1 FROM public.company WHERE id = %s",
                    (payload["company_id"],),
                )
                if not await cur.fetchone():
                    raise HTTPException(status_code=404, detail="company not found")

            params.append(dispatch_id)
            await cur.execute(
                f"""
                UPDATE public.water_dispatch
                   SET {", ".join(updates)}
                 WHERE id = %s
             RETURNING id
                """,
                tuple(params),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="dispatch not found")

    return {"ok": True, "id": dispatch_id}


@router.delete("/dispatch/{dispatch_id}")
async def delete_dispatch_admin(dispatch_id: int):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM public.wallet_movement WHERE dispatch_id = %s",
                (dispatch_id,),
            )
            movement_count = int((await cur.fetchone())[0] or 0)

            if movement_count > 0:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "El despacho tiene movimientos financieros asociados y no puede eliminarse.",
                        "wallet_movements": movement_count,
                    },
                )

            await cur.execute(
                "DELETE FROM public.water_dispatch WHERE id = %s RETURNING id",
                (dispatch_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="dispatch not found")

    return {"ok": True, "id": dispatch_id}


# =========================
# ATTACH PHOTO TO EXISTING DISPATCH
# =========================
@router.post("/dispatch/{dispatch_id}/photo")
async def attach_photo(dispatch_id: int, request: Request, background_tasks: BackgroundTasks):
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

    background_tasks.add_task(analyze_dispatch_vehicle, dispatch_id)
    ai_analysis = {"status": "queued"}

    return JSONResponse(
        {
            "ok": True,
            "dispatch_id": dispatch_id,
            "photo_path": public_url,
            "photo_paths_added": [public_url],
            "ai_vehicle_analysis": ai_analysis,
        }
    )
