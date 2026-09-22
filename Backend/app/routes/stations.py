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

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from typing import Optional, List
from app.auth import CurrentUser, require_admin
from app.db import get_conn

router = APIRouter(prefix="/stations", tags=["stations"])


# --------- Schemas ---------
class StationIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    name: Optional[str] = None
    active: bool = True
    device_ip: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None


class StationOut(BaseModel):
    id: str
    name: Optional[str] = None
    active: bool
    device_ip: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None


class StationActivePatch(BaseModel):
    active: bool


class StationPatch(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    device_ip: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None


# --------- Helpers ---------
def _row_to_out(row) -> StationOut:
    return StationOut(
        id=row[0],
        name=row[1],
        active=bool(row[2]),
        device_ip=row[3],
        device_model=row[4],
        device_serial=row[5],
    )


# --------- Endpoints ---------
@router.get("", response_model=List[StationOut])
async def list_stations():
    # ✅ get_conn() es async context manager → usar async with
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name, active, device_ip, device_model, device_serial FROM public.station ORDER BY id;")
            rows = await cur.fetchall()
    return [_row_to_out(r) for r in rows]


@router.get("/{station_id}", response_model=StationOut)
async def get_station(station_id: str = Path(..., min_length=1)):
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, active, device_ip, device_model, device_serial FROM public.station WHERE id = %s;",
                (station_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
    return _row_to_out(row)


@router.post("", response_model=StationOut, status_code=201)
async def upsert_station(s: StationIn, _user: CurrentUser = Depends(require_admin)):
    """
    Crea o actualiza una estación (upsert por id).
    """
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
                    """
                    INSERT INTO public.station
                        (id, name, active, device_ip, device_model, device_serial)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                        SET name = EXCLUDED.name,
                            active = EXCLUDED.active,
                            device_ip = EXCLUDED.device_ip,
                            device_model = EXCLUDED.device_model,
                            device_serial = EXCLUDED.device_serial
                    RETURNING id, name, active, device_ip, device_model, device_serial;
                    """,
                    (s.id, s.name, s.active, s.device_ip, s.device_model, s.device_serial),
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
    _user: CurrentUser = Depends(require_admin),
):
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.station
                   SET active = %s
                 WHERE id = %s
             RETURNING id, name, active, device_ip, device_model, device_serial;
                """,
                (patch.active, station_id),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
    return _row_to_out(row)


@router.patch("/{station_id}", response_model=StationOut)
async def update_station(
    patch: StationPatch,
    station_id: str = Path(..., min_length=1),
    _user: CurrentUser = Depends(require_admin),
):
    fields = []
    params = []

    if patch.name is not None:
        fields.append("name = %s")
        params.append(patch.name)
    if patch.active is not None:
        fields.append("active = %s")
        params.append(patch.active)
    if patch.device_ip is not None:
        fields.append("device_ip = %s")
        params.append(patch.device_ip or None)
    if patch.device_model is not None:
        fields.append("device_model = %s")
        params.append(patch.device_model or None)
    if patch.device_serial is not None:
        fields.append("device_serial = %s")
        params.append(patch.device_serial or None)

    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    params.append(station_id)

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                UPDATE public.station
                   SET {", ".join(fields)}
                 WHERE id = %s
             RETURNING id, name, active, device_ip, device_model, device_serial;
                """,
                tuple(params),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")

    return _row_to_out(row)


@router.delete("/{station_id}")
async def delete_station(station_id: str = Path(..., min_length=1), _user: CurrentUser = Depends(require_admin)):
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM public.water_dispatch WHERE station_id = %s) AS dispatches,
                  (SELECT COUNT(*) FROM public.access_event WHERE station_id = %s) AS access_events,
                  (SELECT COUNT(*) FROM public.access_credential WHERE station_id = %s) AS credentials
                """,
                (station_id, station_id, station_id),
            )
            counts = await cur.fetchone()

            if counts and any(int(v or 0) > 0 for v in counts):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "La estación tiene historial asociado. Desactivala en lugar de eliminarla.",
                        "dispatches": int(counts[0] or 0),
                        "access_events": int(counts[1] or 0),
                        "credentials": int(counts[2] or 0),
                    },
                )

            await cur.execute(
                "DELETE FROM public.station WHERE id = %s RETURNING id;",
                (station_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")

    return {"ok": True, "id": station_id}
