# app/routes/company_sync.py
import os
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import quote_plus

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import httpx

from app.db import pool

router = APIRouter()

# ---- Solo modo GET (un servicio HTTPS que ya tenés) ----
SYNC_GET_URL_TEMPLATE = os.getenv("SYNC_GET_URL_TEMPLATE", "").strip()
SYNC_GET_BEARER = os.getenv("SYNC_GET_BEARER", "").strip()
SYNC_GET_TLS_VERIFY = os.getenv("SYNC_GET_TLS_VERIFY", "true").lower() not in ("0","false","no")
SYNC_GET_TIMEOUT_S = float(os.getenv("SYNC_GET_TIMEOUT_S", "10"))

class CompanySyncResponse(BaseModel):
    ok: bool
    method: str = "GET"
    company_code: str
    station_id: str
    forwarded_url: str
    status: int
    response: Optional[Dict[str, Any]] = None

def _format_get_url(template: str, mapping: Dict[str, Any]) -> str:
    # Reemplaza {clave} por valor URL-encoded
    url = template
    for k, v in mapping.items():
        val = "" if v is None else str(v)
        url = url.replace("{" + k + "}", quote_plus(val))
    return url

async def _call_get(url: str) -> Tuple[int, Dict[str, Any]]:
    if not SYNC_GET_URL_TEMPLATE:
        raise HTTPException(status_code=500, detail="Falta SYNC_GET_URL_TEMPLATE en env")
    headers = {}
    if SYNC_GET_BEARER:
        headers["Authorization"] = f"Bearer {SYNC_GET_BEARER}"
    async with httpx.AsyncClient(timeout=SYNC_GET_TIMEOUT_S, verify=SYNC_GET_TLS_VERIFY) as client:
        resp = await client.get(url, headers=headers)
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
    # 1) Company + Station (solo para obtener datos; no se contacta ningún dispositivo)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name, code, pin, active FROM public.company WHERE code=%s", (code,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="company not found")
            (_cid, company_name, company_code, company_pin, company_active) = row
            if not company_active:
                raise HTTPException(status_code=400, detail="company inactive")

            await cur.execute("SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active", (station_id,))
            srow = await cur.fetchone()
            if not srow:
                raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

    # 2) Armar parámetros
    name = name_override or company_name
    password = None
    if op != "delete":
        password = pin_override or company_pin
        if not password:
            raise HTTPException(status_code=400, detail="company.pin es NULL (o pasá pin_override)")

    mapping = {
        "op": op,
        "station_id": station_id,
        "device_ip": device_ip or "",
        "device_serial": device_serial or "",
        "employeeNo": company_code,
        "code": company_code,           # alias útil
        "name": name or "",
        "password": password or "",
    }

    url = _format_get_url(SYNC_GET_URL_TEMPLATE, mapping)
    status, out = await _call_get(url)
    ok = status < 400

    if not ok:
        raise HTTPException(status_code=502, detail={"message": "sync error", "status": status, "response": out})

    return CompanySyncResponse(
        ok=True, company_code=company_code, station_id=station_id,
        forwarded_url=url, status=status, response=out,
    )

@router.post("/hik-sync-all")
async def hik_sync_all(
    station_id: str = Query(..., description="ID de station destino"),
    op: str = Query("upsert", description="upsert|delete"),
):
    # Cargar station
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, device_ip, device_serial FROM public.station WHERE id=%s AND active", (station_id,))
            srow = await cur.fetchone()
            if not srow:
                raise HTTPException(status_code=404, detail="station not found or inactive")
            (_sid, device_ip, device_serial) = srow

            await cur.execute(
                "SELECT id, name, code, pin FROM public.company WHERE active AND (pin IS NOT NULL OR %s='delete')",
                (op,),
            )
            companies = await cur.fetchall()

    results: List[Dict[str, Any]] = []
    for (_cid, name, code, pin) in companies:
        mapping = {
            "op": op,
            "station_id": station_id,
            "device_ip": device_ip or "",
            "device_serial": device_serial or "",
            "employeeNo": code,
            "code": code,
            "name": name or "",
            "password": ("" if op == "delete" else (str(pin) if pin is not None else "")),
        }
        url = _format_get_url(SYNC_GET_URL_TEMPLATE, mapping)
        try:
            status, out = await _call_get(url)
            ok = status < 400
        except HTTPException as e:
            status, out, ok = 502, {"error": e.detail}, False

        results.append({"code": code, "ok": ok, "status": status, "url": url, "response": out})

    return {"ok": True, "method": "GET", "count": len(results), "results": results}
