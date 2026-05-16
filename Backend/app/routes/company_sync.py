# app/routes/company_sync.py

from fastapi import APIRouter, HTTPException

from app.db import pool

router = APIRouter()


@router.get("/hik-users")
async def list_hik_users():
    """
    Devuelve las empresas para sincronizar con el teclado Hikvision.

    IMPORTANTE:
    - Antes devolvía solo active = true.
    - Ahora devuelve activas e inactivas.
    - Así Node-RED puede saber si debe habilitar o deshabilitar el usuario en el teclado.

    Respuesta:
    {
      "ok": true,
      "count": 4,
      "items": [
        {
          "employeeNo": "1",
          "name": "TECHIN",
          "password": "1234",
          "active": true
        }
      ]
    }
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    name,
                    code,
                    pin,
                    active
                FROM public.company
                WHERE pin IS NOT NULL
                  AND pin <> ''
                  AND code IS NOT NULL
                  AND code <> ''
                ORDER BY code ASC
                LIMIT 2000
                """
            )

            rows = await cur.fetchall()

    items = []

    for r in rows:
        name = r[0]
        code = r[1]
        pin = r[2]
        active = r[3]

        items.append(
            {
                # En Hikvision esto es employeeNo.
                # En tu DB coincide con public.company.code.
                "employeeNo": str(code),

                # Nombre visible en el teclado.
                "name": str(name),

                # PIN que se carga en el teclado.
                "password": str(pin),

                # Estado real de la empresa.
                # Node-RED lo usa para habilitar/deshabilitar.
                "active": bool(active),
            }
        )

    return {
        "ok": True,
        "count": len(items),
        "items": items,
    }


@router.get("/{code}/hik-user")
async def get_hik_user(code: str):
    """
    Devuelve una credencial individual por code.

    Si la empresa está inactiva, igual la devuelve con active=false.
    Esto permite que un sistema externo pueda saber que debe deshabilitarla
    en el teclado, en vez de simplemente ignorarla.
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    name,
                    code,
                    pin,
                    active
                FROM public.company
                WHERE code = %s
                """,
                (code,),
            )

            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    name = row[0]
    company_code = row[1]
    pin = row[2]
    active = row[3]

    return {
        "ok": True,
        "item": {
            "employeeNo": str(company_code),
            "name": str(name),
            "password": None if pin is None else str(pin),
            "active": bool(active),
        },
    }
