from __future__ import annotations

import os
import json
import datetime
from typing import Any, Dict, Optional

import httpx
import xmltodict
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from app.db import pool

router = APIRouter()

# =========================
# ENV
# =========================
# fallback si el evento no trae station_id (por ahora)
DEFAULT_STATION_ID = os.getenv("STATION_ID", "PALACIO")

# webhook de Node-RED (sin seguridad por ahora)
NODE_RED_DISPATCH_WEBHOOK = os.getenv("NODE_RED_DISPATCH_WEBHOOK", "")  # ej: http://IP:1880/hik/dispatch_started


# =========================
# Helpers
# =========================
def _to_int(x) -> Optional[int]:
    try:
        if x is None or x == "":
            return None
        return int(x)
    except Exception:
        return None


def _parse_ts(s: Optional[str]) -> datetime.datetime:
    if not s:
        return datetime.datetime.now(datetime.timezone.utc)
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc)


def _pick_station_id(root: Dict[str, Any], acs: Dict[str, Any]) -> str:
    """
    Intenta sacar station_id del payload (si existe). Si no hay, usa DEFAULT_STATION_ID.

    En el futuro esto lo podés mapear por:
      - source_ip
      - device_serial
      - device_id
      - etc.
    """
    # si Hik manda algún campo identificador (depende el modelo/config)
    for key in ("stationId", "deviceId", "deviceID", "terminalNo", "terminalId", "devIndex"):
        v = acs.get(key) or root.get(key)
        if v:
            return str(v).strip()
    return DEFAULT_STATION_ID


async def _notify_node_red_dispatch_started(payload: Dict[str, Any]) -> None:
    """
    Best-effort: si Node-RED está caído, NO rompemos nada.
    Sin seguridad por ahora.
    """
    if not NODE_RED_DISPATCH_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(NODE_RED_DISPATCH_WEBHOOK, json=payload)
    except Exception:
        return


# =========================
# Normalización Hik
# =========================
def normalize_hik_event(data: Dict[str, Any]) -> Dict[str, Any]:
    root = data.get("EventNotificationAlert") or data
    acs = root.get("AcsEvent", {}) or {}

    ts = _parse_ts(root.get("dateTime") or root.get("eventTime") or acs.get("absTime"))
    station_id = _pick_station_id(root, acs)

    status_str = (acs.get("statusString") or "").lower()
    error_code = (acs.get("errorCode") or "")
    event_type = (root.get("eventType") or acs.get("eventType") or "").lower()

    granted = False
    if "ok" in status_str or "success" in status_str or "pass" in status_str:
        granted = True
    elif error_code in ("0", "", None) and "denied" not in event_type and "fail" not in status_str:
        granted = True
    if "alarm" in event_type or "tamper" in event_type:
        granted = False

    return {
        "station_id": station_id,
        "ts": ts,
        "result": root.get("eventType") or acs.get("eventType") or "unknown",
        "reason": acs.get("errorCode") or acs.get("currentVerifyMode") or "",
        "door_index": _to_int(acs.get("doorNo")),
        "reader_index": _to_int(acs.get("readerNo")),
        "person_id": acs.get("employeeNoString") or acs.get("employeeNo") or "",
        "person_name": acs.get("name") or "",
        "credential_type": (acs.get("currentVerifyMode") or "").lower(),  # password/card/face...
        "credential_value": acs.get("cardNo") or "",
        "direction": (acs.get("accessDirection") or "").lower(),
        "pic_url": acs.get("picUrl") or root.get("picUrl") or "",
        "granted": granted,
        "raw": root,
    }


# =========================
# DB writes
# =========================
async def insert_access_event(ev: Dict[str, Any]) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.access_event
                    (station_id, ts, granted, result, reason,
                     door_index, reader_index, person_id, person_name,
                     credential_type, credential_value, direction,
                     pic_url, snapshot_path, raw)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s)
                RETURNING id
                """,
                (
                    ev["station_id"],
                    ev["ts"],
                    ev["granted"],
                    ev["result"],
                    ev["reason"],
                    ev["door_index"],
                    ev["reader_index"],
                    ev["person_id"],
                    ev["person_name"],
                    ev["credential_type"],
                    ev["credential_value"],
                    ev["direction"],
                    ev["pic_url"],
                    json.dumps(ev["raw"]),
                ),
            )
            row = await cur.fetchone()
            return int(row[0])


async def maybe_start_dispatch(ev: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    verify_mode = (ev.get("credential_type") or "").lower()
    company_code = (ev.get("person_id") or "").strip()
    station_id = ev.get("station_id") or DEFAULT_STATION_ID

    if not ev.get("granted") or not company_code:
        return None
    if "password" not in verify_mode:
        return None

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name FROM public.company WHERE code=%s AND active",
                (company_code,),
            )
            r = await cur.fetchone()
            if not r:
                return None

            company_id = int(r[0])
            company_name = r[1]

            # si Hik provee picUrl lo guardamos, pero luego Node-RED lo reemplaza con foto camión
            photo_path = ev.get("pic_url") or None

            await cur.execute(
                """
                INSERT INTO public.water_dispatch (station_id, company_id, photo_path, note)
                VALUES (%s, %s, %s, 'despacho iniciado por PIN')
                RETURNING id, ts
                """,
                (station_id, company_id, photo_path),
            )
            row = await cur.fetchone()
            dispatch_id = int(row[0])
            ts = row[1]

    return {
        "dispatch_id": dispatch_id,
        "station_id": station_id,
        "company_code": company_code,
        "company_name": company_name,
        "ts": ts.isoformat() if ts else None,
    }


# =========================
# Routes
# =========================
@router.post("/webhook")
async def webhook(request: Request):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")

    ct = (request.headers.get("content-type") or "").lower()
    try:
        if "xml" in ct or body.strip().startswith(b"<"):
            data = xmltodict.parse(body)
        else:
            data = json.loads(body.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot parse payload: {e}")

    ev = normalize_hik_event(data)

    event_id = await insert_access_event(ev)
    dispatch_info = await maybe_start_dispatch(ev)

    if dispatch_info:
        await _notify_node_red_dispatch_started(
            {
                "event_id": event_id,
                "dispatch_id": dispatch_info["dispatch_id"],
                "station_id": dispatch_info["station_id"],
                "company_code": dispatch_info["company_code"],
                "company_name": dispatch_info["company_name"],
                "ts": dispatch_info["ts"],
            }
        )

    return JSONResponse(
        {"ok": True, "event_id": event_id, "dispatch_id": dispatch_info["dispatch_id"] if dispatch_info else None}
    )


@router.post("/test")
async def test_event(payload: Dict[str, Any]):
    ev = {
        "station_id": payload.get("station_id") or DEFAULT_STATION_ID,
        "ts": datetime.datetime.now(datetime.timezone.utc),
        "result": payload.get("eventType", "AccessControl"),
        "reason": payload.get("currentVerifyMode", "password"),
        "door_index": None,
        "reader_index": None,
        "person_id": payload.get("employeeNoString", ""),
        "person_name": payload.get("name", ""),
        "credential_type": (payload.get("currentVerifyMode", "password")).lower(),
        "credential_value": payload.get("cardNo", ""),
        "direction": payload.get("accessDirection", "in"),
        "pic_url": payload.get("picUrl", ""),
        "granted": True,
        "raw": payload,
    }

    event_id = await insert_access_event(ev)
    dispatch_info = await maybe_start_dispatch(ev)

    if dispatch_info:
        await _notify_node_red_dispatch_started(
            {
                "event_id": event_id,
                "dispatch_id": dispatch_info["dispatch_id"],
                "station_id": dispatch_info["station_id"],
                "company_code": dispatch_info["company_code"],
                "company_name": dispatch_info["company_name"],
                "ts": dispatch_info["ts"],
            }
        )

    return {"ok": True, "event_id": event_id, "dispatch_id": dispatch_info["dispatch_id"] if dispatch_info else None}
