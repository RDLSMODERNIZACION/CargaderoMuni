from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.db import pool

router = APIRouter(prefix="/system-health", tags=["system-health"])

STALE_SECONDS = 120


class DeviceHeartbeat(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=100)
    device_type: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=120)
    ip: Optional[str] = None
    status: str = Field(..., min_length=1, max_length=30)
    latency_ms: Optional[int] = Field(None, ge=0)
    error: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/heartbeat")
async def heartbeat(body: DeviceHeartbeat):
    now = datetime.now(timezone.utc)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT status
                FROM public.system_device_health
                WHERE device_id = %s
                """,
                (body.device_id,),
            )
            existing = await cur.fetchone()
            previous_status = existing[0] if existing else None

            await cur.execute(
                """
                INSERT INTO public.system_device_health
                    (device_id, device_type, name, ip, status, latency_ms, last_error, last_seen, updated_at, metadata)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id) DO UPDATE SET
                    device_type = EXCLUDED.device_type,
                    name = EXCLUDED.name,
                    ip = EXCLUDED.ip,
                    status = EXCLUDED.status,
                    latency_ms = EXCLUDED.latency_ms,
                    last_error = EXCLUDED.last_error,
                    last_seen = EXCLUDED.last_seen,
                    updated_at = EXCLUDED.updated_at,
                    metadata = EXCLUDED.metadata
                """,
                (
                    body.device_id,
                    body.device_type,
                    body.name,
                    body.ip,
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
                        (device_id, device_type, name, ip, previous_status, status, error, latency_ms)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        body.device_id,
                        body.device_type,
                        body.name,
                        body.ip,
                        previous_status,
                        body.status,
                        body.error,
                        body.latency_ms,
                    ),
                )

    return {"ok": True, "device_id": body.device_id, "status": body.status}


@router.get("")
async def list_health():
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    device_id,
                    device_type,
                    name,
                    ip,
                    status,
                    latency_ms,
                    last_error,
                    last_seen,
                    metadata
                FROM public.system_device_health
                ORDER BY
                    CASE device_type
                        WHEN 'access_control' THEN 1
                        WHEN 'camera' THEN 2
                        WHEN 'plc' THEN 3
                        WHEN 'node_red' THEN 4
                        ELSE 5
                    END,
                    name
                """
            )
            rows = await cur.fetchall()

    now = datetime.now(timezone.utc)
    items = []

    for r in rows:
        age_seconds = max(0, int((now - r[7]).total_seconds())) if r[7] else None
        effective_status = r[4]

        if age_seconds is None or age_seconds > STALE_SECONDS:
            effective_status = "offline"

        items.append(
            {
                "device_id": r[0],
                "device_type": r[1],
                "name": r[2],
                "ip": r[3],
                "status": effective_status,
                "reported_status": r[4],
                "latency_ms": r[5],
                "last_error": (
                    "Sin heartbeat reciente"
                    if effective_status == "offline" and r[4] == "online"
                    else r[6]
                ),
                "last_seen": r[7].isoformat() if r[7] else None,
                "age_seconds": age_seconds,
                "metadata": r[8] or {},
            }
        )

    # Si este endpoint responde, el backend está online.
    items.append(
        {
            "device_id": "backend",
            "device_type": "backend",
            "name": "Backend CargaderoMuni",
            "ip": "cargaderomuni.onrender.com",
            "status": "online",
            "reported_status": "online",
            "latency_ms": None,
            "last_error": None,
            "last_seen": now.isoformat(),
            "age_seconds": 0,
            "metadata": {},
        }
    )

    return {"ok": True, "stale_seconds": STALE_SECONDS, "items": items}


@router.get("/events")
async def list_health_events(limit: int = 100):
    limit = max(1, min(limit, 500))

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    id,
                    device_id,
                    device_type,
                    name,
                    ip,
                    previous_status,
                    status,
                    error,
                    latency_ms,
                    created_at
                FROM public.system_device_health_event
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
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
                "previous_status": r[5],
                "status": r[6],
                "error": r[7],
                "latency_ms": r[8],
                "created_at": r[9].isoformat() if r[9] else None,
            }
            for r in rows
        ],
    }
