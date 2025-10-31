# app/routes/company_sync.py
import os, ssl
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

from app.db import pool

router = APIRouter()

NODERED_BASE_URL = os.getenv("NODERED_BASE_URL", "").rstrip("/")  # ej.: https://usr300-tunel.trycloudflare.com
NODERED_HIK_SYNC_PATH = os.getenv("NODERED_HIK_SYNC_PATH", "/hik/user-sync")
NODERED_BEARER = os.getenv("NODERED_BEARER", "")
NODERED_TIMEOUT_S = float(os.getenv("NODERED_TIMEOUT_S", "10"))
NODERED_TLS_VERIFY = os.getenv("NODERED_TLS_VERIFY", "true").lower() not in ("0", "false", "no")

class CompanySyncResponse(BaseModel):
    ok: bool
    company_code: str
    station_id: str
    device_ip: Optional[str] = None
    device_serial: Optional[str] = None
    forwarded: Dict[str, Any] = {}
    node_red_status: Optional[int] = None
    node_red_response: Optional[Dict[str, Any]] = None

def _build_headers() -> Dict[str,str]:
    headers = {"Content-Type": "application/json"}
    if NODERED_BEARER:
        headers["Authorization"] = f"Bearer {NODERED_BEARER}"
    return headers

async def _call_nodered(payload: Dict[str, Any]) -> (int, Dict[str, Any]):
    if not NODERED_BASE_URL:
        raise HTTPException(status_code=500, detail="Falta NODERED_BASE_URL en env")
    url = f"{NODERED_BASE_URL}{NODERED_HIK_SYNC_PATH}"
    headers = _build_headers()
    verify = True if NODERED_TLS_VERIFY else False
    async with httpx.AsyncClient(timeout=NODERED_TIMEOUT_S, verify=verify) as client:
        resp = await client.post(url, headers=headers, json=payload)
        try:
            data = resp.json()
        except Exception:
            data = {"text": resp.text}
        return resp.status_code, data

@router.post("/{code}/hik-sync", response_model=CompanySyncResponse)
async def hik_sync_company(
    code: str,
    station_id: str = Query(..., description="ID de station (tabla public.station.id)"),
    op: str = Query("upsert", description="upsert|delete"),
    name_override: Optional[str] = Query(None),
    pin_override: Optional[str] = Query(None),
):
    # 1) Company
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, code, pin, active FROM public.company WHERE code=%s",
                (code,),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="company not found")
            (company_id, company_name, company_code, company_pin, company_active) = row
            if not company_active:
                raise HTTPException(status_code=400, detail="company inactive")

            # 2) Station
            await cur.execute(
                "SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active",
                (station_id,),
            )
            srow = await cur.fetchone()
            if not srow:
                raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

    # 3) Payload a Node-RED
    hik_user = {
        "employeeNo": company_code,
        "name": name_override or company_name,
    }
    if op != "delete":
        pin = pin_override or company_pin
        if not pin:
            raise HTTPException(status_code=400, detail="company.pin es NULL (o pasá pin_override)")
        hik_user["password"] = str(pin)

    payload = {
        "op": op,  # upsert|delete
        "station_id": station_id,
        "device_ip": device_ip,
        "device_serial": device_serial,
        "hik_user": hik_user,
        "right": {  # opcional: derechos por puerta y ventana de validez
            "doorNos": [1],
            "beginTime": "2020-01-01T00:00:00",
            "endTime": "2037-12-31T23:59:59",
            "planTemplateNo": 1
        }
    }

    status, nodered = await _call_nodered(payload)
    if status >= 400 or not isinstance(nodered, dict) or not nodered.get("ok", False):
        raise HTTPException(
            status_code=502,
            detail={"message": "Node-RED error", "status": status, "response": nodered},
        )

    return CompanySyncResponse(
        ok=True,
        company_code=company_code,
        station_id=station_id,
        device_ip=device_ip,
        device_serial=device_serial,
        forwarded=payload,
        node_red_status=status,
        node_red_response=nodered,
    )

@router.post("/hik-sync-all")
async def hik_sync_all(
    station_id: str = Query(..., description="ID de station destino"),
    op: str = Query("upsert", description="upsert|delete"),
):
    """Empuja TODAS las companies activas con PIN no nulo al teclado."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, code, pin FROM public.company WHERE active AND pin IS NOT NULL"
            )
            companies = await cur.fetchall()
            await cur.execute(
                "SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active",
                (station_id,),
            )
            srow = await cur.fetchone()
            if not srow:
                raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

    results: List[Dict[str, Any]] = []
    for (_cid, name, code, pin) in companies:
        payload = {
            "op": op,
            "station_id": station_id,
            "device_ip": device_ip,
            "device_serial": device_serial,
            "hik_user": {"employeeNo": code, "name": name, **({} if op=="delete" else {"password": str(pin)})},
            "right": {"doorNos": [1], "planTemplateNo": 1},
        }
        try:
            status, out = await _call_nodered(payload)
            ok = (status < 400) and bool(out.get("ok", False))
        except HTTPException as e:
            ok = False
            out = {"error": str(e.detail)}
            status = 502
        results.append({"code": code, "status": status, "ok": ok, "node_red": out})

    return {"ok": True, "count": len(results), "results": results}
