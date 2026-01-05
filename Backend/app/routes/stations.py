# app/routes/stations.py
# CRUD mínimo para estaciones/cargaderos.
# Endpoints:
#   GET    /stations                       → listar estaciones
#   GET    /stations/{station_id}          → obtener una estación
#   POST   /stations                       → crear/actualizar (upsert)
#   PATCH  /stations/{station_id}/active   → activar/desactivar
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
    return StationOut(id=row[0], name=row[1], active=bool(row[2]))


# --------- Endpoints ---------
@router.get("", response_model=List[StationOut])
async def list_stations():
    # ✅ get_conn() es async context manager → usar async with
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name, active FROM public.station ORDER BY id;")
            rows = await cur.fetchall()
    return [_row_to_out(r) for r in rows]


@router.get("/{station_id}", response_model=StationOut)
async def get_station(station_id: str = Path(..., min_length=1)):
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, active FROM public.station WHERE id = %s;",
                (station_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
    return _row_to_out(row)


@router.post("", response_model=StationOut, status_code=201)
async def upsert_station(s: StationIn):
    """
    Crea o actualiza una estación (upsert por id).
    """
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
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
                row = await cur.fetchone()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Error upsert station: {e}")

    if not row:
        raise HTTPException(status_code=500, detail="Upsert no devolvió fila (unexpected)")
    return _row_to_out(row)


@router.patch("/{station_id}/active", response_model=StationOut)
async def set_station_active(
    patch: StationActivePatch,
    station_id: str = Path(..., min_length=1),
):
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.station
                   SET active = %s
                 WHERE id = %s
             RETURNING id, name, active;
                """,
                (patch.active, station_id),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
    return _row_to_out(row)
