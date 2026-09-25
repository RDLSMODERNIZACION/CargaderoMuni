from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.auth import (
    CurrentUser,
    accessible_station_ids,
    get_current_user,
    require_station_access,
)
from app.db import pool
from app.services.hik_sync import resolve_driver
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
    employee_no: Optional[str] = None
    card_no: Optional[str] = None
    access_method: Optional[str] = None
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


async def resolve_access(cur, request, station_id, company_code, employee_no, card_no, method):
    if employee_no or card_no or method == "rfid":
        user_id, company_id, code = await resolve_driver(
            cur, station_id, employee_no, card_no, company_code)
        return user_id, company_id, code, "rfid"
    if method not in ("", "manual", "company_pin"):
        raise HTTPException(422, "Unsupported access_method")
    if company_code:
        await cur.execute(
            """
            SELECT c.id
            FROM public.company c
            JOIN public.station_company_access sca
              ON sca.company_id = c.id
             AND sca.station_id = %s
             AND sca.active
            WHERE c.code = %s
              AND c.active
            """,
            (station_id, company_code),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(
                403,
                "Empresa no habilitada para esta estación",
            )
        return None, int(row[0]), company_code, "company_pin"
    if method == "company_pin":
        raise HTTPException(422, "company_code is required")
    return None, None, "", "manual"


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

        employee_no = str(form.get("employee_no") or "").strip()
        card_no = str(form.get("card_no") or "").strip()
        requested_method = str(form.get("access_method") or "").strip()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                pin_user_id, company_id, company_code, access_method = await resolve_access(
                    cur, request, station_id, company_code, employee_no, card_no, requested_method)

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
                        (station_id, company_id, photo_path, photo_paths, note, pin_user_id, access_method)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, ts
                    """,
                    (
                        station_id,
                        company_id,
                        main_photo,
                        Jsonb(uploaded_urls),
                        note, pin_user_id, access_method,
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
                "pin_user_id": pin_user_id, "access_method": access_method,
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
            pin_user_id, company_id, company_code, access_method = await resolve_access(
                cur, request, payload.station_id, (payload.company_code or "").strip(),
                (payload.employee_no or "").strip(), (payload.card_no or "").strip(),
                payload.access_method or "")

            photo_paths = [payload.photo_path] if payload.photo_path else []

            await cur.execute(
                """
                INSERT INTO public.water_dispatch
                    (station_id, company_id, photo_path, photo_paths, note, pin_user_id, access_method)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, ts
                """,
                (
                    payload.station_id,
                    company_id,
                    payload.photo_path,
                    Jsonb(photo_paths),
                    payload.note, pin_user_id, access_method,
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
        "pin_user_id": pin_user_id, "access_method": access_method,
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
async def recent(
    limit: int = 20,
    station_id: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
):
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
    allowed = await accessible_station_ids(user)

    if allowed is not None and station_id and station_id not in allowed:
        raise HTTPException(status_code=403, detail="No tenés acceso a esa estación")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            where = []
            params = []

            if allowed is not None:
                if not allowed:
                    where.append("FALSE")
                else:
                    where.append("wd.station_id = ANY(%s)")
                    params.append(allowed)

            if station_id:
                where.append("wd.station_id = %s")
                params.append(station_id)

            where_sql = ("WHERE " + " AND ".join(where)) if where else ""
            params.append(limit)

            await cur.execute(
                f"""
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
                    c.code AS company_code,
                    wd.pin_user_id, p.name AS driver_name, wd.access_method, wd.ended_at, wd.offline_meta
                FROM public.water_dispatch wd
                LEFT JOIN public.company c
                    ON c.id = wd.company_id
                LEFT JOIN public.pin_user p ON p.id = wd.pin_user_id
                {where_sql}
                ORDER BY wd.ts DESC
                LIMIT %s
                """,
                tuple(params),
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
                "pin_user_id": r[12], "driver_name": r[13], "access_method": r[14],
                "ended_at": r[15].isoformat() if r[15] else None,
                "timing": dispatch_timing(r[16]),
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
async def get_dispatch(
    dispatch_id: int,
    user: CurrentUser = Depends(get_current_user),
):
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
                    c.code AS company_code,
                        wd.pin_user_id, p.name AS driver_name, wd.access_method, wd.ended_at, wd.offline_meta
                FROM public.water_dispatch wd
                LEFT JOIN public.company c ON c.id = wd.company_id
                    LEFT JOIN public.pin_user p ON p.id = wd.pin_user_id
                LEFT JOIN public.station s ON s.id = wd.station_id
                WHERE wd.id = %s
                """,
                (dispatch_id,),
            )
            r = await cur.fetchone()

    if not r:
        raise HTTPException(status_code=404, detail="dispatch not found")

    await require_station_access(user, str(r[2]))

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
            "pin_user_id": r[18], "driver_name": r[19], "access_method": r[20],
            "ended_at": r[21].isoformat() if r[21] else None,
            "timing": dispatch_timing(r[22]),
        },
    }


# =========================
# ADMIN DISPATCH CRUD
# =========================
@router.post("/dispatch/admin")
async def create_dispatch_admin(
    body: AdminDispatchCreate,
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, body.station_id, {"owner", "admin", "operator"})
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
                SELECT 1
                FROM public.station_company_access
                WHERE station_id=%s
                  AND company_id=%s
                  AND active
                """,
                (body.station_id, body.company_id),
            )
            if not await cur.fetchone():
                raise HTTPException(
                    status_code=403,
                    detail="La empresa no está habilitada para esta estación",
                )

            await cur.execute(
                """
                INSERT INTO public.water_dispatch
                    (station_id, company_id, liters, flow_l_min, note, ts, access_method)
                VALUES
                    (%s, %s, %s, %s, %s, COALESCE(%s, now()), 'manual')
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
async def update_dispatch_admin(
    dispatch_id: int,
    body: AdminDispatchPatch,
    user: CurrentUser = Depends(get_current_user),
):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT station_id FROM public.water_dispatch WHERE id=%s",
                (dispatch_id,),
            )
            current = await cur.fetchone()

    if not current:
        raise HTTPException(status_code=404, detail="dispatch not found")

    current_station_id = str(current[0])
    await require_station_access(
        user,
        current_station_id,
        {"owner", "admin", "operator"},
    )

    if body.station_id is not None and body.station_id != current_station_id:
        await require_station_access(
            user,
            body.station_id,
            {"owner", "admin", "operator"},
        )

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

            final_station_id = payload.get("station_id", current_station_id)

            if "company_id" in payload:
                final_company_id = payload["company_id"]
            else:
                await cur.execute(
                    "SELECT company_id FROM public.water_dispatch WHERE id=%s",
                    (dispatch_id,),
                )
                current_company = await cur.fetchone()
                final_company_id = current_company[0] if current_company else None

            if final_company_id is not None:
                await cur.execute(
                    """
                    SELECT 1
                    FROM public.station_company_access
                    WHERE station_id=%s
                      AND company_id=%s
                      AND active
                    """,
                    (final_station_id, final_company_id),
                )
                if not await cur.fetchone():
                    raise HTTPException(
                        status_code=403,
                        detail="La empresa no está habilitada para esta estación",
                    )

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
async def delete_dispatch_admin(
    dispatch_id: int,
    user: CurrentUser = Depends(get_current_user),
):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT station_id FROM public.water_dispatch WHERE id=%s",
                (dispatch_id,),
            )
            current = await cur.fetchone()

    if not current:
        raise HTTPException(status_code=404, detail="dispatch not found")

    await require_station_access(
        user,
        str(current[0]),
        {"owner", "admin"},
    )

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


def dispatch_timing(meta):
    meta = meta or {}
    return {key: meta.get(key) for key in
            ('meter_method', 'pump_started_at', 'review_reasons', 'volume_calculation')}


class TimeConversion(BaseModel):
    flow_l_min: float = Field(gt=0, le=1e6, allow_inf_nan=False)


@router.post('/dispatch/{dispatch_id}/convert-time')
async def convert_dispatch_time(dispatch_id: int, body: TimeConversion,
                                user: CurrentUser = Depends(get_current_user)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute('SELECT station_id FROM public.water_dispatch WHERE id=%s', (dispatch_id,))
            station = await cur.fetchone()
            if not station:
                raise HTTPException(404, 'dispatch not found')
            await require_station_access(user, str(station[0]), {'owner', 'admin', 'operator'})
            await cur.execute('SELECT ended_at, offline_meta, debited_at FROM public.water_dispatch WHERE id=%s FOR UPDATE', (dispatch_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, 'dispatch not found')
            end, meta, debited = row
            meta = dict(meta or {})
            if debited:
                raise HTTPException(409, 'El despacho ya fue debitado; requiere ajuste administrativo')
            start = meta.get('pump_started_at')
            if meta.get('meter_method') != 'timestamps' or not start or not end:
                raise HTTPException(409, 'Faltan inicio y fin reales de bomba para convertir')
            if {'reinicio_durante_carga', 'intervalo_sin_medicion', 'sin_arranque_observado'} & set(meta.get('review_reasons', [])):
                raise HTTPException(409, 'Los horarios requieren revisión por interrupciones; no se puede convertir automáticamente')
            seconds = (end - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()
            if seconds < 0:
                raise HTTPException(409, 'Fin anterior al inicio')
            liters = round(seconds / 60 * body.flow_l_min, 3)
            if liters > 1e9:
                raise HTTPException(422, 'Volumen fuera de rango')
            calc = dict(flow_l_min=body.flow_l_min, duration_seconds=seconds, liters=liters,
                        method='time_estimate', calculated_by=user.id,
                        calculated_at=datetime.now(timezone.utc).isoformat())
            meta['volume_calculation'] = calc
            await cur.execute('UPDATE public.water_dispatch SET liters=%s, flow_l_min=%s, offline_meta=%s WHERE id=%s',
                              (liters, body.flow_l_min, Jsonb(meta), dispatch_id))
    return dict(ok=True, liters=liters, calculation=calc)
