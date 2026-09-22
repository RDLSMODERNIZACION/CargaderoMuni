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
from app.auth import CurrentUser, accessible_station_ids, get_current_user, require_station_access
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
    organization_id: Optional[int] = None


class StationOut(BaseModel):
    id: str
    name: Optional[str] = None
    active: bool
    device_ip: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None
    organization_id: Optional[int] = None


class StationActivePatch(BaseModel):
    active: bool


class StationCompanyPatch(BaseModel):
    active: bool


class StationPatch(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    device_ip: Optional[str] = None
    device_model: Optional[str] = None
    device_serial: Optional[str] = None
    organization_id: Optional[int] = None


# --------- Helpers ---------
def _row_to_out(row) -> StationOut:
    return StationOut(
        id=row[0],
        name=row[1],
        active=bool(row[2]),
        device_ip=row[3],
        device_model=row[4],
        device_serial=row[5],
        organization_id=row[6],
    )


# --------- Endpoints ---------
@router.get("", response_model=List[StationOut])
async def list_stations(user: CurrentUser = Depends(get_current_user)):
    allowed = await accessible_station_ids(user)

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            if allowed is None:
                await cur.execute(
                    "SELECT id, name, active, device_ip, device_model, device_serial, organization_id FROM public.station ORDER BY id;"
                )
            elif not allowed:
                rows = []
                return []
            else:
                await cur.execute(
                    """
                    SELECT id, name, active, device_ip, device_model, device_serial, organization_id
                    FROM public.station
                    WHERE id = ANY(%s)
                    ORDER BY id
                    """,
                    (allowed,),
                )
            rows = await cur.fetchall()

    return [_row_to_out(r) for r in rows]


@router.get("/{station_id}", response_model=StationOut)
async def get_station(
    station_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id)

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, active, device_ip, device_model, device_serial, organization_id FROM public.station WHERE id = %s;",
                (station_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")
    return _row_to_out(row)


@router.post("", response_model=StationOut, status_code=201)
async def upsert_station(s: StationIn, user: CurrentUser = Depends(get_current_user)):
    """
    Crea una estación nueva. Solo el owner global puede hacerlo.
    """
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Solo el owner global puede crear estaciones")

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
                    """
                    INSERT INTO public.station
                        (id, name, active, device_ip, device_model, device_serial, organization_id)
                    VALUES (
                        %s, %s, %s, %s, %s, %s,
                        COALESCE(%s, (SELECT id FROM public.organization ORDER BY id LIMIT 1))
                    )
                    ON CONFLICT (id) DO UPDATE
                        SET name = EXCLUDED.name,
                            active = EXCLUDED.active,
                            device_ip = EXCLUDED.device_ip,
                            device_model = EXCLUDED.device_model,
                            device_serial = EXCLUDED.device_serial,
                            organization_id = COALESCE(EXCLUDED.organization_id, public.station.organization_id)
                    RETURNING id, name, active, device_ip, device_model, device_serial, organization_id;
                    """,
                    (s.id, s.name, s.active, s.device_ip, s.device_model, s.device_serial, s.organization_id),
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
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id, {"owner", "admin"})
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.station
                   SET active = %s
                 WHERE id = %s
             RETURNING id, name, active, device_ip, device_model, device_serial, organization_id;
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
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id, {"owner", "admin"})
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
    if patch.organization_id is not None:
        fields.append("organization_id = %s")
        params.append(patch.organization_id)

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
             RETURNING id, name, active, device_ip, device_model, device_serial, organization_id;
                """,
                tuple(params),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' no encontrada")

    return _row_to_out(row)


@router.delete("/{station_id}")
async def delete_station(
    station_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id, {"owner", "admin"})

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



# --------- Empresas habilitadas por estación ---------
@router.get("/{station_id}/companies")
async def list_station_companies(
    station_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id)

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    c.id,
                    c.name,
                    c.code,
                    c.pin,
                    c.active,
                    COALESCE(sca.active, FALSE) AS allowed
                FROM public.company c
                LEFT JOIN public.station_company_access sca
                  ON sca.company_id = c.id
                 AND sca.station_id = %s
                ORDER BY c.name, c.id
                """,
                (station_id,),
            )
            rows = await cur.fetchall()

    return {
        "ok": True,
        "station_id": station_id,
        "items": [
            {
                "id": int(r[0]),
                "name": r[1],
                "code": r[2],
                "pin": r[3],
                "active": bool(r[4]),
                "allowed": bool(r[5]),
            }
            for r in rows
        ],
    }


@router.put("/{station_id}/companies/{company_id}")
async def set_station_company_access(
    company_id: int,
    body: StationCompanyPatch,
    station_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
):
    await require_station_access(user, station_id, {"owner", "admin"})

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM public.company WHERE id=%s",
                (company_id,),
            )
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Empresa no encontrada")

            await cur.execute(
                """
                INSERT INTO public.station_company_access
                    (station_id, company_id, active, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (station_id, company_id) DO UPDATE SET
                    active = EXCLUDED.active,
                    updated_at = now()
                """,
                (station_id, company_id, body.active),
            )

    return {
        "ok": True,
        "station_id": station_id,
        "company_id": company_id,
        "active": body.active,
    }
