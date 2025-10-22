# app/routes/stations.py
# CRUD mínimo para estaciones/cargaderos.
# Endpoints:
#   GET    /stations                 → listar estaciones
#   GET    /stations/{station_id}    → obtener una estación
#   POST   /stations                 → crear/actualizar (upsert)
#   PATCH  /stations/{station_id}/active  → activar/desactivar
#
# Requiere:
#   - Tabla public.station (id TEXT PK, name TEXT, active BOOL, created_at TIMESTAMPTZ)

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field
from typing import Optional, List
from app.db import get_conn

router = APIRouter(prefix="/stations", tags=["stations"])

# --------- Schemas ---------
class StationIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    name: Optional[str] = None
    active: bool = True

class StationOut(BaseModel):
    id: str
    name: Optional[str] = None
    active: bool

class StationActivePatch(BaseModel):
    active: bool

# --------- Helpers ---------
def _row_to_out(row) -> StationOut:
    # row: (id, name, active)
    return StationOut(id=row[0], name=row[1], active=row[2])

# --------- Endpoints ---------
@router.get("", response_model=List[StationOut])
def list_stations():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name, active FROM public.station ORDER BY id;")
        rows = cur.fetchall()
        return [_row_to_out(r) for r in rows]

@router.get("/{station_id}", response_model=StationOut)
def get_station(station_id: str = Path(..., min_length=1)):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name, active FROM public.station WHERE id = %s;", (station_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
        return _row_to_out(row)

@router.post("", response_model=StationOut, status_code=201)
def upsert_station(s: StationIn):
    """
    Crea o actualiza una estación (upsert por id).
    """
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO public.station (id, name, active)
                VALUES (%s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                    SET name = EXCLUDED.name,
                        active = EXCLUDED.active
                RETURNING id, name, active;
                """,
                (s.id, s.name, s.active),
            )
            row = cur.fetchone()
            return _row_to_out(row)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error upsert station: {e}")

@router.patch("/{station_id}/active", response_model=StationOut)
def set_station_active(patch: StationActivePatch, station_id: str = Path(..., min_length=1)):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.station
               SET active = %s
             WHERE id = %s
         RETURNING id, name, active;
            """,
            (patch.active, station_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
        return _row_to_out(row)
