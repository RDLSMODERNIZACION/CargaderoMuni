from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

import httpx
from fastapi import Depends, Header, HTTPException, status

from app.db import pool

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE", "")


@dataclass
class CurrentUser:
    id: str
    email: str | None
    role: str
    active: bool


async def _resolve_supabase_user(access_token: str) -> dict:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE:
        raise HTTPException(
            status_code=500,
            detail="Supabase auth configuration missing",
        )

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "apikey": SUPABASE_SERVICE_ROLE,
            },
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o vencida",
        )

    return response.json()


async def get_current_user(
    authorization: str | None = Header(default=None),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticación requerida",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticación requerida",
        )

    auth_user = await _resolve_supabase_user(token)
    user_id = str(auth_user.get("id") or "")
    email = auth_user.get("email")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario inválido",
        )

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT role, active, email
                FROM public.app_user
                WHERE user_id = %s
                """,
                (user_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario sin permisos en la aplicación",
        )

    role = str(row[0])
    active = bool(row[1])
    stored_email = row[2]

    if not active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario deshabilitado",
        )

    return CurrentUser(
        id=user_id,
        email=stored_email or email,
        role=role,
        active=active,
    )


def require_roles(*roles: str):
    allowed = set(roles)

    async def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tenés permisos para realizar esta acción",
            )
        return user

    return dependency


require_owner = require_roles("owner")
require_admin = require_roles("owner", "admin")
require_operator = require_roles("owner", "admin", "operator")
