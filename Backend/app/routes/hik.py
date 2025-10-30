import os, json, datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import xmltodict

from app.db import pool

router = APIRouter()

STATION_ID = os.getenv("STATION_ID", "PALACIO")          # 1 estación = 1 teclado
WEBHOOK_TOKEN = os.getenv("HIK_WEBHOOK_TOKEN", None)     # opcional

def _auth_ok(req: Request) -> bool:
    if not WEBHOOK_TOKEN:
        return True
    return req.headers.get("authorization") == f"Bearer {WEBHOOK_TOKEN}"

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

def normalize_hik_event(data: Dict[str, Any]) -> Dict[str, Any]:
    root = data.get("EventNotificationAlert") or data
    acs = root.get("AcsEvent", {}) or {}

    ts = _parse_ts(root.get("dateTime") or root.get("eventTime") or acs.get("absTime"))

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
                    STATION_ID, ev["ts"], ev["granted"], ev["result"], ev["reason"],
                    ev["door_index"], ev["reader_index"], ev["person_id"], ev["person_name"],
                    ev["credential_type"], ev["credential_value"], ev["direction"],
                    ev["pic_url"], json.dumps(ev["raw"]),
                ),
            )
            row = await cur.fetchone()
            return int(row[0])

async def maybe_start_dispatch(ev: Dict[str, Any]) -> Optional[int]:
    verify_mode = ev.get("credential_type", "")
    employee_no = (ev.get("person_id") or "").strip()
    if not ev.get("granted") or not employee_no:
        return None
    if "password" not in verify_mode:
        return None

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # buscar empresa por code
            await cur.execute(
                "SELECT id FROM public.company WHERE code=%s AND active",
                (employee_no,),
            )
            r = await cur.fetchone()
            if not r:
                return None
            company_id = int(r[0])

            photo_path = ev.get("pic_url") or None

            await cur.execute(
                """
                INSERT INTO public.water_dispatch (station_id, company_id, photo_path, note)
                VALUES (%s, %s, %s, 'despacho iniciado por PIN')
                RETURNING id
                """,
                (STATION_ID, company_id, photo_path),
            )
            row = await cur.fetchone()
            return int(row[0])

@router.post("/webhook")
async def webhook(request: Request):
    if not _auth_ok(request):
        raise HTTPException(status_code=401, detail="Unauthorized")

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
    dispatch_id = await maybe_start_dispatch(ev)
    return JSONResponse({"ok": True, "event_id": event_id, "dispatch_id": dispatch_id})

# Endpoint de prueba con JSON ya-normalizado (para Postman/curl)
@router.post("/test")
async def test_event(payload: Dict[str, Any]):
    ev = {
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
    dispatch_id = await maybe_start_dispatch(ev)
    return {"ok": True, "event_id": event_id, "dispatch_id": dispatch_id}
