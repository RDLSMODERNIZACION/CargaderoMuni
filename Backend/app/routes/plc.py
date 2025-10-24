# app/routes/plc.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_conn
from datetime import datetime, timezone
import os, httpx

router = APIRouter(prefix="/plc", tags=["plc"])

PLC_BASE = os.getenv("PLC_BASE_URL")  # ej: http://192.168.1.50:8080  (si usás HTTP nativo)

class DIEvent(BaseModel):
    station_id: str
    di: str   # "DI1" o "DI2"
    state: int  # 0/1

@router.post("/di")
def di_event(ev: DIEvent):
    ts = datetime.now(timezone.utc)

    # Tomar el último dispatch “running” de la estación
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id FROM public.dispatch
            WHERE station_id=%s AND status='running'
            ORDER BY started_at DESC LIMIT 1
        """, (ev.station_id,))
        row = cur.fetchone()
        dispatch_id = row[0] if row else None

        # Registrar evento de bomba
        state = "start_pressed" if ev.di=="DI1" and ev.state==1 else \
                "stop_pressed" if ev.di=="DI2" and ev.state==1 else "di_change"
        cur.execute("""
            INSERT INTO public.pump_event (station_id, dispatch_id, ts, state, source, note)
            VALUES (%s,%s,%s,%s,'controller',%s)
        """, (ev.station_id, dispatch_id, ts, state, f"{ev.di}={ev.state}"))

        # Lógica simple: DI1→DO1 ON, DI2→DO1 OFF (+ opcional DO2 ON)
        if PLC_BASE:
            if ev.di=="DI1" and ev.state==1:
                # START
                _plc_do(1, 1)
                # aseguramos que el dispatch siga en running
            elif ev.di=="DI2" and ev.state==1:
                # STOP
                _plc_do(1, 0)
                _plc_do(2, 1)  # si querés un pulso de alarma:
                _plc_do(2, 0)

        # Si fue STOP y existe dispatch, cerrarlo
        if ev.di=="DI2" and ev.state==1 and dispatch_id:
            cur.execute("""
                UPDATE public.dispatch
                SET status='stopped', ended_at=%s
                WHERE id=%s
            """, (ts, dispatch_id))

        conn.commit()

    return {"ok": True}

def _plc_do(ch: int, status: int):
    # Ejemplo para HTTP nativo del PLC (adaptá a tu firmware)
    url = f"{PLC_BASE}/api/do?ch={ch}&status={status}"
    try:
        httpx.get(url, timeout=2.5)
    except Exception:
        pass

# Endpoint opcional para forzar DO manualmente desde backoffice
@router.post("/do/{ch}/{status}")
def set_do(ch: int, status: int):
    if ch not in (1,2) or status not in (0,1):
        raise HTTPException(400, "Parámetros inválidos")
    if not PLC_BASE:
        raise HTTPException(503, "PLC_BASE_URL no configurada")
    _plc_do(ch, status)
    return {"ok": True}
