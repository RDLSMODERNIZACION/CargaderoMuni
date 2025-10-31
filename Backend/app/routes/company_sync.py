# app/routes/company_sync.py
import os
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import quote_plus

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

from app.db import pool

router = APIRouter()

# ---- Modo de operación ----
# auto | nodered | direct | get
COMPANY_SYNC_MODE = os.getenv("COMPANY_SYNC_MODE", "auto").lower()

# ---- Modo GET (tu otro servicio) ----
SYNC_GET_URL_TEMPLATE = os.getenv("SYNC_GET_URL_TEMPLATE", "").strip()
SYNC_GET_BEARER = os.getenv("SYNC_GET_BEARER", "").strip()
SYNC_GET_TLS_VERIFY = os.getenv("SYNC_GET_TLS_VERIFY", "true").lower() not in ("0","false","no")
SYNC_GET_TIMEOUT_S = float(os.getenv("SYNC_GET_TIMEOUT_S", "10"))

# ---- Gateway/Node-RED (opcional) ----
NODERED_BASE_URL = os.getenv("NODERED_BASE_URL", "").rstrip("/")
NODERED_HIK_SYNC_PATH = os.getenv("NODERED_HIK_SYNC_PATH", "/hik/user-sync")
NODERED_BEARER = os.getenv("NODERED_BEARER", "")
NODERED_TIMEOUT_S = float(os.getenv("NODERED_TIMEOUT_S", "10"))
NODERED_TLS_VERIFY = os.getenv("NODERED_TLS_VERIFY", "true").lower() not in ("0","false","no")

# ---- Acceso directo a Hikvision (ISAPI) ----
HIK_USER = os.getenv("HIK_USER", "admin")
HIK_PASS = os.getenv("HIK_PASS", "")
HIK_PROTOCOL = os.getenv("HIK_PROTOCOL", "http")  # http | https
HIK_PORT = os.getenv("HIK_PORT", "").strip()
HIK_TIMEOUT_S = float(os.getenv("HIK_TIMEOUT_S", "10"))

class CompanySyncResponse(BaseModel):
    ok: bool
    mode: str
    company_code: str
    station_id: str
    device_ip: Optional[str] = None
    device_serial: Optional[str] = None
    forwarded: Dict[str, Any] = {}
    target_status: Optional[int] = None
    target_response: Optional[Dict[str, Any]] = None

def _choose_mode() -> str:
    if COMPANY_SYNC_MODE in ("nodered", "direct", "get"):
        return COMPANY_SYNC_MODE
    # auto: prioridad GET si hay plantilla; luego nodered; sino direct
    if SYNC_GET_URL_TEMPLATE:
        return "get"
    if NODERED_BASE_URL:
        return "nodered"
    return "direct"

def _gw_headers() -> Dict[str,str]:
    h = {"Content-Type": "application/json"}
    if NODERED_BEARER: h["Authorization"] = f"Bearer {NODERED_BEARER}"
    return h

async def _call_gateway(payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    if not NODERED_BASE_URL:
        raise HTTPException(status_code=500, detail="Falta NODERED_BASE_URL en env")
    url = f"{NODERED_BASE_URL}{NODERED_HIK_SYNC_PATH}"
    async with httpx.AsyncClient(timeout=NODERED_TIMEOUT_S, verify=NODERED_TLS_VERIFY) as client:
        resp = await client.post(url, headers=_gw_headers(), json=payload)
        try: data = resp.json()
        except Exception: data = {"text": resp.text}
        return resp.status_code, data

def _hik_base(device_ip: str) -> str:
    return f"{HIK_PROTOCOL}://{device_ip}:{HIK_PORT}" if HIK_PORT else f"{HIK_PROTOCOL}://{device_ip}"

async def _hik_request(method: str, url: str, body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=HIK_TIMEOUT_S, verify=(HIK_PROTOCOL=="https")) as client:
        resp = await client.request(method, url, json=body, auth=httpx.DigestAuth(HIK_USER, HIK_PASS))
        if resp.status_code == 401:
            resp = await client.request(method, url, json=body, auth=httpx.BasicAuth(HIK_USER, HIK_PASS))
        try: data = resp.json()
        except Exception: data = {"text": resp.text}
        return resp.status_code, data

async def _call_direct(op: str, device_ip: str, hik_user: Dict[str, Any], right: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    base = _hik_base(device_ip)
    if op == "delete":
        url = f"{base}/ISAPI/AccessControl/UserInfo/Delete?format=json"
        body = {"UserInfo": {"employeeNo": str(hik_user["employeeNo"])}}
        return await _hik_request("DELETE", url, body)

    doors = right.get("doorNos") or [1]
    begin = right.get("beginTime") or "2020-01-01T00:00:00"
    end   = right.get("endTime")   or "2037-12-31T23:59:59"

    url_create = f"{base}/ISAPI/AccessControl/UserInfo/Record?format=json"
    body_create = {
        "UserInfo": {
            "employeeNo": str(hik_user["employeeNo"]),
            "name": hik_user.get("name") or str(hik_user["employeeNo"]),
            "userType": "normal",
            "Valid": {"enable": True, "beginTime": begin, "endTime": end},
            "doorRight": ",".join(map(str, doors)),
        }
    }
    if hik_user.get("password"):
        body_create["UserInfo"]["password"] = str(hik_user["password"])

    st, data = await _hik_request("POST", url_create, body_create)
    status_code = (data.get("statusCode") if isinstance(data, dict) else None)
    if 200 <= st < 300 and (status_code is None or status_code == 1):
        return st, data

    url_mod = f"{base}/ISAPI/AccessControl/UserInfo/Modify?format=json"
    body_mod = {"UserInfo": {
        "employeeNo": str(hik_user["employeeNo"]),
        "name": hik_user.get("name") or str(hik_user["employeeNo"]),
    }}
    if hik_user.get("password"):
        body_mod["UserInfo"]["password"] = str(hik_user["password"])
    return await _hik_request("PUT", url_mod, body_mod)

def _format_get_url(template: str, mapping: Dict[str, Any]) -> str:
    # Reemplazo simple {clave} por valor URL-encoded
    url = template
    for k, v in mapping.items():
        val = "" if v is None else str(v)
        url = url.replace("{" + k + "}", quote_plus(val))
    return url

async def _call_get(payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    if not SYNC_GET_URL_TEMPLATE:
        raise HTTPException(status_code=500, detail="Falta SYNC_GET_URL_TEMPLATE en env")
    hik_user = payload["hik_user"]
    url = _format_get_url(SYNC_GET_URL_TEMPLATE, {
        "op": payload["op"],
        "station_id": payload["station_id"],
        "device_ip": payload.get("device_ip"),
        "device_serial": payload.get("device_serial",""),
        "employeeNo": hik_user.get("employeeNo"),
        "code": hik_user.get("employeeNo"),        # alias
        "name": hik_user.get("name",""),
        "password": hik_user.get("password",""),
    })
    headers = {}
    if SYNC_GET_BEARER:
        headers["Authorization"] = f"Bearer {SYNC_GET_BEARER}"
    async with httpx.AsyncClient(timeout=SYNC_GET_TIMEOUT_S, verify=SYNC_GET_TLS_VERIFY) as client:
        resp = await client.get(url, headers=headers)
        try: data = resp.json()
        except Exception: data = {"text": resp.text}
        return resp.status_code, data

@router.post("/{code}/hik-sync", response_model=CompanySyncResponse)
async def hik_sync_company(
    code: str,
    station_id: str = Query(..., description="ID de station (tabla public.station.id)"),
    op: str = Query("upsert", description="upsert|delete"),
    name_override: Optional[str] = Query(None),
    pin_override: Optional[str] = Query(None),
):
    # 1) Company + Station
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name, code, pin, active FROM public.company WHERE code=%s", (code,))
            row = await cur.fetchone()
            if not row: raise HTTPException(status_code=404, detail="company not found")
            (_cid, company_name, company_code, company_pin, company_active) = row
            if not company_active: raise HTTPException(status_code=400, detail="company inactive")
            await cur.execute("SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active", (station_id,))
            srow = await cur.fetchone()
            if not srow: raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

    hik_user = {"employeeNo": company_code, "name": name_override or company_name}
    if op != "delete":
        pin = pin_override or company_pin
        if not pin: raise HTTPException(status_code=400, detail="company.pin es NULL (o pasá pin_override)")
        hik_user["password"] = str(pin)

    payload = {
        "op": op,
        "station_id": station_id,
        "device_ip": device_ip,
        "device_serial": device_serial,
        "hik_user": hik_user,
        "right": {"doorNos": [1], "beginTime": "2020-01-01T00:00:00", "endTime": "2037-12-31T23:59:59", "planTemplateNo": 1},
    }

    mode = _choose_mode()
    if mode == "get":
        st, out = await _call_get(payload)
    elif mode == "nodered":
        st, out = await _call_gateway(payload)
    else:
        st, out = await _call_direct(op, device_ip, hik_user, payload["right"])

    ok = (st < 400) and (not isinstance(out, dict) or out.get("ok", True))
    if not ok:
        raise HTTPException(status_code=502, detail={"message": "sync error", "mode": mode, "status": st, "response": out})

    return CompanySyncResponse(
        ok=True, mode=mode,
        company_code=company_code, station_id=station_id,
        device_ip=device_ip, device_serial=device_serial,
        forwarded=payload, target_status=st, target_response=out,
    )

@router.post("/hik-sync-all")
async def hik_sync_all(
    station_id: str = Query(..., description="ID de station destino"),
    op: str = Query("upsert", description="upsert|delete"),
):
    mode = _choose_mode()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name, code, pin FROM public.company WHERE active AND (pin IS NOT NULL OR %s='delete')", (op,))
            companies = await cur.fetchall()
            await cur.execute("SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active", (station_id,))
            srow = await cur.fetchone()
            if not srow: raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

    results: List[Dict[str, Any]] = []
    for (_cid, name, code, pin) in companies:
        hik_user = {"employeeNo": code, "name": name}
        if op != "delete" and pin is not None:
            hik_user["password"] = str(pin)
        payload = {
            "op": op, "station_id": station_id,
            "device_ip": device_ip, "device_serial": device_serial,
            "hik_user": hik_user, "right": {"doorNos": [1], "planTemplateNo": 1},
        }
        try:
            if mode == "get":   st, out = await _call_get(payload)
            elif mode == "nodered": st, out = await _call_gateway(payload)
            else:               st, out = await _call_direct(op, device_ip, hik_user, payload["right"])
            ok = (st < 400) and (not isinstance(out, dict) or out.get("ok", True))
        except HTTPException as e:
            ok, out, st = False, {"error": e.detail}, 502
        results.append({"code": code, "status": st, "ok": ok, "response": out})
    return {"ok": True, "mode": mode, "count": len(results), "results": results}
