from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_owner
from app.db import pool

router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrganizationIn(BaseModel):
    name: str
    active: bool = True


class OrganizationPatch(BaseModel):
    name: str | None = None
    active: bool | None = None


class OrganizationUserPatch(BaseModel):
    role: str
    active: bool = True


class StationUserPatch(BaseModel):
    role: str
    active: bool = True


@router.get("")
async def list_organizations(user: CurrentUser = Depends(get_current_user)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if user.role == "owner":
                await cur.execute(
                    """
                    SELECT o.id, o.name, o.active,
                           COUNT(DISTINCT s.id) AS stations
                    FROM public.organization o
                    LEFT JOIN public.station s ON s.organization_id = o.id
                    GROUP BY o.id, o.name, o.active
                    ORDER BY o.name
                    """
                )
            else:
                await cur.execute(
                    """
                    SELECT o.id, o.name, o.active,
                           COUNT(DISTINCT s.id) AS stations
                    FROM public.organization o
                    JOIN public.organization_user ou
                      ON ou.organization_id = o.id
                     AND ou.user_id = %s
                     AND ou.active
                    LEFT JOIN public.station s ON s.organization_id = o.id
                    WHERE o.active
                    GROUP BY o.id, o.name, o.active
                    ORDER BY o.name
                    """,
                    (user.id,),
                )

            rows = await cur.fetchall()

    return {
        "ok": True,
        "items": [
            {
                "id": int(r[0]),
                "name": r[1],
                "active": bool(r[2]),
                "station_count": int(r[3] or 0),
            }
            for r in rows
        ],
    }


@router.post("")
async def create_organization(
    body: OrganizationIn,
    _owner: CurrentUser = Depends(require_owner),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nombre obligatorio")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.organization (name, active, updated_at)
                VALUES (%s, %s, now())
                RETURNING id, name, active
                """,
                (name, body.active),
            )
            row = await cur.fetchone()

    return {"ok": True, "item": {"id": int(row[0]), "name": row[1], "active": bool(row[2])}}


@router.patch("/{organization_id}")
async def update_organization(
    organization_id: int,
    body: OrganizationPatch,
    _owner: CurrentUser = Depends(require_owner),
):
    fields = []
    params = []

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nombre obligatorio")
        fields.append("name = %s")
        params.append(name)

    if body.active is not None:
        fields.append("active = %s")
        params.append(body.active)

    if not fields:
        raise HTTPException(status_code=400, detail="Sin cambios")

    fields.append("updated_at = now()")
    params.append(organization_id)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                UPDATE public.organization
                SET {", ".join(fields)}
                WHERE id = %s
                RETURNING id, name, active
                """,
                tuple(params),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Organización no encontrada")

    return {"ok": True}


@router.get("/{organization_id}/access")
async def organization_access(
    organization_id: int,
    _owner: CurrentUser = Depends(require_owner),
):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT s.id, s.name, s.active
                FROM public.station s
                WHERE s.organization_id = %s
                ORDER BY s.name
                """,
                (organization_id,),
            )
            stations = await cur.fetchall()

            await cur.execute(
                """
                SELECT
                    au.user_id,
                    au.email,
                    au.active,
                    ou.role,
                    ou.active
                FROM public.app_user au
                LEFT JOIN public.organization_user ou
                  ON ou.user_id = au.user_id
                 AND ou.organization_id = %s
                ORDER BY au.email
                """,
                (organization_id,),
            )
            users = await cur.fetchall()

            await cur.execute(
                """
                SELECT su.station_id, su.user_id, su.role, su.active
                FROM public.station_user su
                JOIN public.station s ON s.id = su.station_id
                WHERE s.organization_id = %s
                """,
                (organization_id,),
            )
            station_access = await cur.fetchall()

    return {
        "ok": True,
        "stations": [
            {"id": r[0], "name": r[1], "active": bool(r[2])}
            for r in stations
        ],
        "users": [
            {
                "user_id": str(r[0]),
                "email": r[1],
                "app_active": bool(r[2]),
                "organization_role": r[3],
                "organization_active": bool(r[4]) if r[4] is not None else None,
            }
            for r in users
        ],
        "station_access": [
            {
                "station_id": r[0],
                "user_id": str(r[1]),
                "role": r[2],
                "active": bool(r[3]),
            }
            for r in station_access
        ],
    }


@router.put("/{organization_id}/users/{user_id}")
async def set_organization_user(
    organization_id: int,
    user_id: str,
    body: OrganizationUserPatch,
    _owner: CurrentUser = Depends(require_owner),
):
    if body.role not in {"owner", "admin", "operator", "viewer"}:
        raise HTTPException(status_code=400, detail="Rol inválido")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.organization_user
                    (organization_id, user_id, role, active, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (organization_id, user_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    active = EXCLUDED.active,
                    updated_at = now()
                """,
                (organization_id, user_id, body.role, body.active),
            )

    return {"ok": True}


@router.delete("/{organization_id}/users/{user_id}")
async def remove_organization_user(
    organization_id: int,
    user_id: str,
    _owner: CurrentUser = Depends(require_owner),
):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                DELETE FROM public.organization_user
                WHERE organization_id=%s AND user_id=%s
                """,
                (organization_id, user_id),
            )
    return {"ok": True}


@router.put("/{organization_id}/stations/{station_id}/users/{user_id}")
async def set_station_user(
    organization_id: int,
    station_id: str,
    user_id: str,
    body: StationUserPatch,
    _owner: CurrentUser = Depends(require_owner),
):
    if body.role not in {"admin", "operator", "viewer"}:
        raise HTTPException(status_code=400, detail="Rol inválido")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT 1
                FROM public.station
                WHERE id=%s AND organization_id=%s
                """,
                (station_id, organization_id),
            )
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Estación no encontrada")

            await cur.execute(
                """
                INSERT INTO public.station_user
                    (station_id, user_id, role, active, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (station_id, user_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    active = EXCLUDED.active,
                    updated_at = now()
                """,
                (station_id, user_id, body.role, body.active),
            )

    return {"ok": True}


@router.delete("/{organization_id}/stations/{station_id}/users/{user_id}")
async def remove_station_user(
    organization_id: int,
    station_id: str,
    user_id: str,
    _owner: CurrentUser = Depends(require_owner),
):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                DELETE FROM public.station_user su
                USING public.station s
                WHERE su.station_id=s.id
                  AND s.organization_id=%s
                  AND su.station_id=%s
                  AND su.user_id=%s
                """,
                (organization_id, station_id, user_id),
            )

    return {"ok": True}
