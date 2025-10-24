# app/routes/access.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db import get_conn
from datetime import datetime, timezone
import hashlib

router = APIRouter(prefix="/access", tags=["access"])

class IngresoPayload(BaseModel):
    station_id: str
    raw: str  # PIN o dato del lector
    ts: datetime | None = None

def _hash_pin(pin: str) -> str:
    # Igualá este hash a como guardás pin_hash (bcrypt/sha256). Ejemplo sha256:
    return hashlib.sha256(pin.encode()).hexdigest()

@router.post("/ingreso")
def ingreso(payload: IngresoPayload):
    ts = payload.ts or datetime.now(timezone.utc)
    pin = payload.raw.strip()

    with get_conn() as conn, conn.cursor() as cur:
        # Validar usuario por PIN (usa el hash que vos tengas en pin_user.pin_hash)
        cur.execute("""
            SELECT id, enabled, tries, locked_until
            FROM public.pin_user
            WHERE pin_hash = %s
        """, (_hash_pin(pin),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(401, "PIN inválido")
        pin_user_id, enabled, tries, locked_until = row
        if not enabled:
            raise HTTPException(403, "Usuario deshabilitado")
        if locked_until and locked_until > ts:
            raise HTTPException(403, "Usuario bloqueado temporalmente")

        # Asegurar estación
        cur.execute("SELECT id, active FROM public.station WHERE id=%s", (payload.station_id,))
        st = cur.fetchone()
        if not st or not st[1]:
            raise HTTPException(404, "Estación inexistente o inactiva")

        # Upsert pin_session activa
        cur.execute("""
            SELECT id FROM public.pin_session
            WHERE pin_user_id=%s AND station_id=%s AND status='active'
            ORDER BY started_at DESC LIMIT 1
        """, (pin_user_id, payload.station_id))
        sess = cur.fetchone()
        if sess:
            pin_session_id = sess[0]
        else:
            cur.execute("""
                INSERT INTO public.pin_session (pin_user_id, station_id, max_liters, status)
                VALUES (%s,%s, %s, 'active')
                RETURNING id
            """, (pin_user_id, payload.station_id, 10000))
            pin_session_id = cur.fetchone()[0]

        # Crear nuevo dispatch “running”
        cur.execute("""
            INSERT INTO public.dispatch (station_id, pin_user_id, pin_session_id, litros_autorizados, status, source)
            VALUES (%s, %s, %s, %s, 'running', 'pin')
            RETURNING id
        """, (payload.station_id, pin_user_id, pin_session_id, 10000))
        dispatch_id = cur.fetchone()[0]

        conn.commit()

    return {"ok": True, "dispatch_id": dispatch_id}
