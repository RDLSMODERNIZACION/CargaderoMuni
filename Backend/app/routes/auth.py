from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_owner
from app.db import pool

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE", "")

router = APIRouter(prefix="/auth", tags=["auth"])


class UserRolePatch(BaseModel):
    role: str | None = None
    active: bool | None = None


class UserCreateIn(BaseModel):
    email: str
    password: str
    role: str = "viewer"


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return {
        "ok": True,
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "active": user.active,
        },
    }


@router.post("/users")
async def create_user(
    body: UserCreateIn,
    _owner: CurrentUser = Depends(require_owner),
):
    email = body.email.strip().lower()
    password = body.password
    role = body.role.strip().lower()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email inválido")

    if len(password) < 8:
        raise HTTPException(
            status_code=400,
            detail="La contraseña debe tener al menos 8 caracteres",
        )

    if role not in {"owner", "admin", "operator", "viewer"}:
        raise HTTPException(status_code=400, detail="Rol inválido")

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
        raise HTTPException(
            status_code=500,
            detail="Supabase auth configuration missing",
        )

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
                "apikey": SUPABASE_SERVICE_ROLE,
                "Content-Type": "application/json",
            },
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
            },
        )

    if response.status_code not in (200, 201):
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise HTTPException(
            status_code=400,
            detail={
                "message": "No se pudo crear el usuario",
                "supabase": detail,
            },
        )

    auth_user = response.json()
    user_id = str(auth_user.get("id") or "")

    if not user_id:
        raise HTTPException(status_code=500, detail="Supabase no devolvió user_id")

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.app_user (user_id, email, role, active, updated_at)
                VALUES (%s, %s, %s, TRUE, now())
                ON CONFLICT (user_id) DO UPDATE SET
                    email = EXCLUDED.email,
                    role = EXCLUDED.role,
                    active = TRUE,
                    updated_at = now()
                RETURNING user_id, email, role, active
                """,
                (user_id, email, role),
            )
            row = await cur.fetchone()

    return {
        "ok": True,
        "user": {
            "user_id": str(row[0]),
            "email": row[1],
            "role": row[2],
            "active": bool(row[3]),
        },
    }


@router.get("/users")
async def list_users(_owner: CurrentUser = Depends(require_owner)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT user_id, email, role, active, created_at, updated_at
                FROM public.app_user
                ORDER BY created_at ASC
                """
            )
            rows = await cur.fetchall()

    return {
        "ok": True,
        "items": [
            {
                "user_id": str(r[0]),
                "email": r[1],
                "role": r[2],
                "active": bool(r[3]),
                "created_at": r[4].isoformat() if r[4] else None,
                "updated_at": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ],
    }


@router.patch("/users/{user_id}")
async def update_user_access(
    user_id: str,
    body: UserRolePatch,
    owner: CurrentUser = Depends(require_owner),
):
    if body.role is None and body.active is None:
        raise HTTPException(status_code=400, detail="No hay cambios para aplicar")

    if body.role is not None and body.role not in {"owner", "admin", "operator", "viewer"}:
        raise HTTPException(status_code=400, detail="Rol inválido")

    if user_id == owner.id and body.active is False:
        raise HTTPException(status_code=400, detail="No podés deshabilitar tu propio usuario")

    if user_id == owner.id and body.role is not None and body.role != "owner":
        raise HTTPException(status_code=400, detail="No podés quitarte el rol owner a vos mismo")

    fields = []
    params = []

    if body.role is not None:
        fields.append("role = %s")
        params.append(body.role)

    if body.active is not None:
        fields.append("active = %s")
        params.append(body.active)

    fields.append("updated_at = now()")
    params.append(user_id)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                UPDATE public.app_user
                SET {", ".join(fields)}
                WHERE user_id = %s
                RETURNING user_id, email, role, active
                """,
                tuple(params),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    return {
        "ok": True,
        "user": {
            "user_id": str(row[0]),
            "email": row[1],
            "role": row[2],
            "active": bool(row[3]),
        },
    }
