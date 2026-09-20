from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.db import pool

router = APIRouter(prefix="/system-health", tags=["system-health"])

STALE_SECONDS = 120
LOCAL_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


class DeviceHeartbeat(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=100)
    device_type: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=120)
    ip: Optional[str] = None
    station_id: Optional[str] = None
    status: str = Field(..., min_length=1, max_length=30)
    latency_ms: Optional[int] = Field(None, ge=0)
    error: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/heartbeat")
async def heartbeat(body: DeviceHeartbeat):
    now = datetime.now(timezone.utc)

    # device_id debe ser único por estación. Los distintos Node-RED usan
    # nombres lógicos iguales (teclado, camara_2, plc_cargadero, node_red).
    # Prefijarlos acá evita que una estación pise el estado de otra.
    station_id = (body.station_id or "").strip() or None
    raw_device_id = body.device_id.strip()
    prefix = f"{station_id}:" if station_id else ""
    device_id = (
        raw_device_id
        if not prefix or raw_device_id.startswith(prefix)
        else prefix + raw_device_id
    )

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT status, station_id
                FROM public.system_device_health
                WHERE device_id = %s
                """,
                (device_id,),
            )
            existing = await cur.fetchone()
            previous_status = existing[0] if existing else None
            previous_station_id = existing[1] if existing else None
            station_id = station_id or previous_station_id

            await cur.execute(
                """
                INSERT INTO public.system_device_health
                    (device_id, device_type, name, ip, station_id, status, latency_ms, last_error, last_seen, updated_at, metadata)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id) DO UPDATE SET
                    device_type = EXCLUDED.device_type,
                    name = EXCLUDED.name,
                    ip = EXCLUDED.ip,
                    station_id = COALESCE(EXCLUDED.station_id, public.system_device_health.station_id),
                    status = EXCLUDED.status,
                    latency_ms = EXCLUDED.latency_ms,
                    last_error = EXCLUDED.last_error,
                    last_seen = EXCLUDED.last_seen,
                    updated_at = EXCLUDED.updated_at,
                    metadata = EXCLUDED.metadata
                """,
                (
                    device_id,
                    body.device_type,
                    body.name,
                    body.ip,
                    station_id,
                    body.status,
                    body.latency_ms,
                    body.error,
                    now,
                    now,
                    Jsonb(body.metadata),
                ),
            )

            if previous_status != body.status:
                await cur.execute(
                    """
                    INSERT INTO public.system_device_health_event
                        (device_id, device_type, name, ip, station_id, previous_status, status, error, latency_ms)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        device_id,
                        body.device_type,
                        body.name,
                        body.ip,
                        station_id,
                        previous_status,
                        body.status,
                        body.error,
                        body.latency_ms,
                    ),
                )

    return {
        "ok": True,
        "device_id": device_id,
        "station_id": station_id,
        "status": body.status,
    }


@router.get("")
async def list_health(station_id: Optional[str] = None):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if station_id:
                await cur.execute(
                    """
                    SELECT
                        device_id, device_type, name, ip, station_id, status,
                        latency_ms, last_error, last_seen, metadata
                    FROM public.system_device_health
                    WHERE station_id = %s
                    ORDER BY
                        CASE device_type
                            WHEN 'access_control' THEN 1
                            WHEN 'camera' THEN 2
                            WHEN 'plc' THEN 3
                            WHEN 'node_red' THEN 4
                            ELSE 5
                        END,
                        name
                    """,
                    (station_id,),
                )
            else:
                await cur.execute(
                    """
                    SELECT
                        device_id, device_type, name, ip, station_id, status,
                        latency_ms, last_error, last_seen, metadata
                    FROM public.system_device_health
                    ORDER BY station_id NULLS LAST, name
                    """
                )

            rows = await cur.fetchall()

    # Durante la transición pueden coexistir IDs viejos ("teclado")
    # y nuevos ("1:teclado"). Para una estación, priorizamos el ID
    # prefijado y evitamos mostrar duplicados.
    if station_id:
        deduped = {}
        prefix = f"{station_id}:"
        for row in rows:
            logical_key = (row[1], row[2], row[3])
            current = deduped.get(logical_key)
            row_scoped = str(row[0]).startswith(prefix)
            current_scoped = bool(current and str(current[0]).startswith(prefix))
            if current is None or (row_scoped and not current_scoped):
                deduped[logical_key] = row
        rows = list(deduped.values())

    now = datetime.now(timezone.utc)
    items = []

    for r in rows:
        age_seconds = max(0, int((now - r[8]).total_seconds())) if r[8] else None
        effective_status = r[5]

        if age_seconds is None or age_seconds > STALE_SECONDS:
            effective_status = "offline"

        items.append(
            {
                "device_id": r[0],
                "device_type": r[1],
                "name": r[2],
                "ip": r[3],
                "station_id": r[4],
                "status": effective_status,
                "reported_status": r[5],
                "latency_ms": r[6],
                "last_error": (
                    "Sin heartbeat reciente"
                    if effective_status == "offline" and r[5] == "online"
                    else r[7]
                ),
                "last_seen": r[8].isoformat() if r[8] else None,
                "age_seconds": age_seconds,
                "metadata": r[9] or {},
            }
        )

    return {"ok": True, "stale_seconds": STALE_SECONDS, "items": items}


@router.get("/stations-summary")
async def stations_summary():
    """
    Devuelve un resumen de comunicación por estación para la grilla principal.
    Considera offline cualquier equipo cuyo heartbeat tenga más de STALE_SECONDS.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    device_id,
                    device_type,
                    name,
                    ip,
                    station_id,
                    status,
                    last_seen
                FROM public.system_device_health
                WHERE station_id IS NOT NULL
                ORDER BY station_id, name
                """
            )
            rows = await cur.fetchall()

    now = datetime.now(timezone.utc)
    by_station: dict[str, list[tuple]] = {}

    for row in rows:
        sid = str(row[4])
        by_station.setdefault(sid, []).append(row)

    items = []

    for station_id, station_rows in by_station.items():
        # Puede haber registros legacy y scoped para el mismo equipo.
        # Priorizamos el ID scoped "<station_id>:...".
        prefix = f"{station_id}:"
        deduped = {}

        for row in station_rows:
            logical_key = (row[1], row[2], row[3])
            current = deduped.get(logical_key)
            row_scoped = str(row[0]).startswith(prefix)
            current_scoped = bool(current and str(current[0]).startswith(prefix))

            if current is None or (row_scoped and not current_scoped):
                deduped[logical_key] = row

        effective = list(deduped.values())
        total = len(effective)
        online = 0
        problem_names = []

        for row in effective:
            reported_status = str(row[5] or "unknown")
            last_seen = row[6]
            age_seconds = (
                max(0, int((now - last_seen).total_seconds()))
                if last_seen
                else None
            )

            status = reported_status
            if age_seconds is None or age_seconds > STALE_SECONDS:
                status = "offline"

            if status == "online":
                online += 1
            else:
                problem_names.append(str(row[2]))

        problems = total - online

        if total == 0:
            overall_status = "no_data"
        elif problems == 0:
            overall_status = "ok"
        else:
            overall_status = "alert"

        items.append(
            {
                "station_id": station_id,
                "status": overall_status,
                "total": total,
                "online": online,
                "problems": problems,
                "problem_names": problem_names,
            }
        )

    return {"ok": True, "items": items}


@router.get("/events")
async def list_health_events(
    limit: int = 100,
    station_id: Optional[str] = None,
    days: Optional[int] = None,
):
    limit = max(1, min(limit, 500))
    days = max(1, min(days, 30)) if days is not None else None

    clauses = []
    params: list[Any] = []

    if station_id:
        clauses.append("station_id = %s")
        params.append(station_id)

    if days:
        clauses.append("created_at >= now() - (%s * interval '1 day')")
        params.append(days)

    where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT
                    id, device_id, device_type, name, ip, station_id,
                    previous_status, status, error, latency_ms, created_at
                FROM public.system_device_health_event
                {where_sql}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = await cur.fetchall()

    return {
        "ok": True,
        "items": [
            {
                "id": r[0],
                "device_id": r[1],
                "device_type": r[2],
                "name": r[3],
                "ip": r[4],
                "station_id": r[5],
                "previous_status": r[6],
                "status": r[7],
                "error": r[8],
                "latency_ms": r[9],
                "created_at": r[10].isoformat() if r[10] else None,
            }
            for r in rows
        ],
    }


@router.get("/weekly")
async def weekly_health(station_id: str):
    now_local = datetime.now(LOCAL_TZ)
    start_day = (now_local - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_day.astimezone(timezone.utc)
    end_utc = now_local.astimezone(timezone.utc)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT device_id, name
                FROM public.system_device_health
                WHERE station_id = %s
                ORDER BY name
                """,
                (station_id,),
            )
            devices = await cur.fetchall()

            await cur.execute(
                """
                SELECT device_id, status, created_at
                FROM public.system_device_health_event
                WHERE station_id = %s
                  AND created_at >= %s
                  AND created_at <= %s
                ORDER BY device_id, created_at ASC
                """,
                (station_id, start_utc, end_utc),
            )
            events = await cur.fetchall()

            await cur.execute(
                """
                SELECT DISTINCT ON (device_id)
                    device_id, status
                FROM public.system_device_health_event
                WHERE station_id = %s
                  AND created_at < %s
                ORDER BY device_id, created_at DESC
                """,
                (station_id, start_utc),
            )
            previous_rows = await cur.fetchall()

    previous_status = {str(r[0]): str(r[1]) for r in previous_rows}
    events_by_device: dict[str, list[tuple[str, datetime]]] = {}

    for device_id, status, created_at in events:
        events_by_device.setdefault(str(device_id), []).append((str(status), created_at))

    day_rows = []
    device_count = len(devices)

    for offset in range(7):
        day_start_local = start_day + timedelta(days=offset)
        day_end_local = day_start_local + timedelta(days=1)
        window_end_local = min(day_end_local, now_local)

        if window_end_local <= day_start_local:
            continue

        day_start_utc = day_start_local.astimezone(timezone.utc)
        day_end_utc = window_end_local.astimezone(timezone.utc)
        total_window_minutes = max(1.0, (day_end_utc - day_start_utc).total_seconds() / 60.0)

        offline_minutes_sum = 0.0
        incidents = 0
        affected_devices: set[str] = set()

        for device_id, _name in devices:
            did = str(device_id)
            device_events = events_by_device.get(did, [])

            status = previous_status.get(did, "online")

            for ev_status, ev_time in device_events:
                if ev_time < day_start_utc:
                    status = ev_status
                else:
                    break

            cursor = day_start_utc

            for ev_status, ev_time in device_events:
                if ev_time < day_start_utc:
                    continue
                if ev_time >= day_end_utc:
                    break

                if status != "online":
                    offline_minutes_sum += max(0.0, (ev_time - cursor).total_seconds() / 60.0)
                    affected_devices.add(did)

                if ev_status != "online" and status == "online":
                    incidents += 1
                    affected_devices.add(did)

                cursor = ev_time
                status = ev_status

            if status != "online":
                offline_minutes_sum += max(0.0, (day_end_utc - cursor).total_seconds() / 60.0)
                affected_devices.add(did)

        possible_minutes = total_window_minutes * max(1, device_count)
        availability_pct = max(
            0.0,
            min(100.0, 100.0 * (possible_minutes - offline_minutes_sum) / possible_minutes),
        )

        day_rows.append(
            {
                "date": day_start_local.date().isoformat(),
                "label": day_start_local.strftime("%d/%m"),
                "availability_pct": round(availability_pct, 2),
                "offline_minutes": round(offline_minutes_sum, 1),
                "incidents": incidents,
                "affected_devices": len(affected_devices),
            }
        )

    return {
        "ok": True,
        "station_id": station_id,
        "device_count": device_count,
        "days": day_rows,
    }
