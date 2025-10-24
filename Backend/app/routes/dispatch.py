# app/routes/dispatch.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_conn
from datetime import datetime, timezone

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

class DispatchOpen(BaseModel):
    station_id: str
    pin_user_id: int
    pin_session_id: int | None = None
    litros_autorizados: float = 10000

@router.post("/open")
def open_dispatch(body: DispatchOpen):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO public.dispatch (station_id, pin_user_id, pin_session_id, litros_autorizados, status, source)
            VALUES (%s,%s,%s,%s,'running','pin')
            RETURNING id
        """, (body.station_id, body.pin_user_id, body.pin_session_id, body.litros_autorizados))
        dispatch_id = cur.fetchone()[0]
        conn.commit()
    return {"ok": True, "dispatch_id": dispatch_id}

@router.post("/{dispatch_id}/stop")
def stop_dispatch(dispatch_id: int):
    ts = datetime.now(timezone.utc)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE public.dispatch SET status='stopped', ended_at=%s WHERE id=%s",
                    (ts, dispatch_id))
        conn.commit()
    return {"ok": True}

class FlowIn(BaseModel):
    station_id: str
    dispatch_id: int | None = None
    liters_total: float | None = None
    flow_l_min: float | None = None
    pulses: int | None = None
    meta: dict | None = None

@router.post("/telemetry")
def telemetry(t: FlowIn):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO public.flow_telemetry (station_id, dispatch_id, liters_total, flow_l_min, pulses, meta)
            VALUES (%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (t.station_id, t.dispatch_id, t.liters_total, t.flow_l_min, t.pulses, t.meta))
        tid = cur.fetchone()[0]

        # Si nos mandan liters_total, podemos actualizar litros_entregados del dispatch
        if t.dispatch_id and t.liters_total is not None:
            cur.execute("""
                UPDATE public.dispatch d
                SET litros_entregados = GREATEST(0, %s),
                    updated_at = now()
                WHERE d.id = %s
            """, (t.liters_total, t.dispatch_id))

        conn.commit()
    return {"ok": True, "telemetry_id": tid}
