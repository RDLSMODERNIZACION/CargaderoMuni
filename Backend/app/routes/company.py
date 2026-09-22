from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.auth import CurrentUser, require_admin
from app.db import pool

router = APIRouter()

class CompanyIn(BaseModel):
    name: str
    code: str = Field(..., description="employeeNo que cargarás en el teclado")
    pin: Optional[str] = Field(None, description="PIN compartido (PoC)")


class CompanyPatch(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    pin: Optional[str] = None
    active: Optional[bool] = None


class DriverIn(BaseModel):
    name: str
    document_number: Optional[str] = None
    phone: Optional[str] = None
    rfid_uid: Optional[str] = None
    printed_card_code: Optional[str] = None
    enabled: bool = True


class DriverPatch(BaseModel):
    name: Optional[str] = None
    document_number: Optional[str] = None
    phone: Optional[str] = None
    rfid_uid: Optional[str] = None
    printed_card_code: Optional[str] = None
    enabled: Optional[bool] = None


def _normalize_rfid(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().upper().replace(" ", "")
    return normalized or None

@router.post("")
async def create_or_update_company(body: CompanyIn, _user: CurrentUser = Depends(require_admin)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.company (name, code, pin, active)
                VALUES (%s, %s, %s, TRUE)
                ON CONFLICT (code) DO UPDATE SET
                  name = EXCLUDED.name,
                  pin  = EXCLUDED.pin,
                  updated_at = now(),
                  active = TRUE
                RETURNING id
                """,
                (body.name, body.code, body.pin),
            )
            row = await cur.fetchone()
            return {"ok": True, "id": int(row[0])}

@router.get("")
async def list_companies(active: bool = True):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if active:
                await cur.execute("SELECT id, name, code, pin, active FROM public.company WHERE active ORDER BY id")
            else:
                await cur.execute("SELECT id, name, code, pin, active FROM public.company ORDER BY id")
            rows = await cur.fetchall()
            return {"ok": True, "items": [
                {"id": r[0], "name": r[1], "code": r[2], "pin": r[3], "active": r[4]} for r in rows
            ]}

@router.get("/id/{company_id}")
async def get_company(company_id: int):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, code, pin, active FROM public.company WHERE id=%s",
                (company_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    return {
        "id": row[0],
        "name": row[1],
        "code": row[2],
        "pin": row[3],
        "active": row[4],
    }


@router.post("/{code}/deactivate")
async def deactivate_company(code: str, _user: CurrentUser = Depends(require_admin)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE public.company SET active=FALSE WHERE code=%s RETURNING id", (code,))
            r = await cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="company not found")
            return {"ok": True}


@router.patch("/id/{company_id}")
async def update_company(company_id: int, body: CompanyPatch, _user: CurrentUser = Depends(require_admin)):
    fields = []
    params = []
    payload = body.model_dump(exclude_unset=True)

    if "name" in payload:
        fields.append("name = %s")
        params.append(payload["name"])
    if "code" in payload:
        fields.append("code = %s")
        params.append(payload["code"])
    if "pin" in payload:
        fields.append("pin = %s")
        params.append(payload["pin"])
    if "active" in payload:
        fields.append("active = %s")
        params.append(payload["active"])

    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    fields.append("updated_at = now()")
    params.append(company_id)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
                    f"""
                    UPDATE public.company
                       SET {", ".join(fields)}
                     WHERE id = %s
                 RETURNING id, name, code, pin, active
                    """,
                    tuple(params),
                )
                row = await cur.fetchone()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Error actualizando empresa: {e}")

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    return {
        "ok": True,
        "item": {
            "id": row[0],
            "name": row[1],
            "code": row[2],
            "pin": row[3],
            "active": row[4],
        },
    }


@router.delete("/id/{company_id}")
async def delete_company(company_id: int, _user: CurrentUser = Depends(require_admin)):
    """
    Elimina la empresa. Los despachos históricos conservan su registro y
    company_id pasa a NULL por la FK ON DELETE SET NULL.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM public.company WHERE id = %s RETURNING id",
                (company_id,),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="company not found")

    return {"ok": True, "id": company_id}



@router.get("/id/{company_id}/drivers")
async def list_company_drivers(company_id: int):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    u.id,
                    u.name,
                    u.document_number,
                    u.phone,
                    u.enabled,
                    u.device_employee_no,
                    u.printed_card_code,
                    cred.id,
                    cred.value,
                    cred.active,
                    cred.valid_from,
                    cred.valid_until
                FROM public.pin_user u
                LEFT JOIN LATERAL (
                    SELECT ac.id, ac.value, ac.active, ac.valid_from, ac.valid_until
                    FROM public.access_credential ac
                    WHERE ac.pin_user_id = u.id
                      AND ac.kind IN ('rfid', 'card')
                    ORDER BY ac.active DESC, ac.id DESC
                    LIMIT 1
                ) cred ON TRUE
                WHERE u.company_id = %s
                ORDER BY u.name, u.id
                """,
                (company_id,),
            )
            rows = await cur.fetchall()

    return {
        "ok": True,
        "items": [
            {
                "id": r[0],
                "name": r[1],
                "document_number": r[2],
                "phone": r[3],
                "enabled": r[4],
                "device_employee_no": r[5],
                "printed_card_code": r[6],
                "rfid_credential_id": r[7],
                "rfid_uid": r[8],
                "rfid_active": r[9] if r[7] is not None else None,
                "rfid_valid_from": r[10],
                "rfid_valid_until": r[11],
            }
            for r in rows
        ],
    }


@router.post("/id/{company_id}/drivers")
async def create_company_driver(company_id: int, body: DriverIn, _user: CurrentUser = Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre del camionero es obligatorio")

    rfid_uid = _normalize_rfid(body.rfid_uid)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM public.company WHERE id=%s",
                (company_id,),
            )
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="company not found")

            try:
                await cur.execute(
                    """
                    INSERT INTO public.pin_user
                        (name, company_id, document_number, phone, printed_card_code, enabled, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, now())
                    RETURNING id
                    """,
                    (
                        name,
                        company_id,
                        body.document_number.strip() if body.document_number else None,
                        body.phone.strip() if body.phone else None,
                        body.printed_card_code.strip() if body.printed_card_code else None,
                        body.enabled,
                    ),
                )
                row = await cur.fetchone()
                driver_id = int(row[0])

                await cur.execute(
                    """
                    UPDATE public.pin_user
                    SET device_employee_no = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (f"DRIVER-{driver_id}", driver_id),
                )

                if rfid_uid:
                    await cur.execute(
                        """
                        INSERT INTO public.access_credential
                            (pin_user_id, kind, value, active, label, metadata, updated_at)
                        VALUES (%s, 'rfid', %s, TRUE, %s, '{}'::jsonb, now())
                        """,
                        (driver_id, rfid_uid, f"RFID · {name}"),
                    )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"No se pudo crear el camionero: {e}")

    return {"ok": True, "id": driver_id, "device_employee_no": f"DRIVER-{driver_id}"}


@router.patch("/id/{company_id}/drivers/{driver_id}")
async def update_company_driver(company_id: int, driver_id: int, body: DriverPatch, _user: CurrentUser = Depends(require_admin)):
    payload = body.model_dump(exclude_unset=True)
    fields = []
    params = []

    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre del camionero es obligatorio")
        fields.append("name = %s")
        params.append(name)
    if "document_number" in payload:
        fields.append("document_number = %s")
        params.append((payload["document_number"] or "").strip() or None)
    if "phone" in payload:
        fields.append("phone = %s")
        params.append((payload["phone"] or "").strip() or None)
    if "printed_card_code" in payload:
        fields.append("printed_card_code = %s")
        params.append((payload["printed_card_code"] or "").strip() or None)
    if "enabled" in payload:
        fields.append("enabled = %s")
        params.append(payload["enabled"])

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name FROM public.pin_user WHERE id=%s AND company_id=%s",
                (driver_id, company_id),
            )
            current = await cur.fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="camionero not found")

            if fields:
                fields.append("updated_at = now()")
                params.extend([driver_id, company_id])
                await cur.execute(
                    f"UPDATE public.pin_user SET {', '.join(fields)} WHERE id=%s AND company_id=%s",
                    tuple(params),
                )

            if "rfid_uid" in payload:
                rfid_uid = _normalize_rfid(payload["rfid_uid"])
                await cur.execute(
                    """
                    UPDATE public.access_credential
                    SET active=FALSE, updated_at=now()
                    WHERE pin_user_id=%s AND kind IN ('rfid','card') AND active=TRUE
                    """,
                    (driver_id,),
                )
                if rfid_uid:
                    try:
                        await cur.execute(
                            """
                            INSERT INTO public.access_credential
                                (pin_user_id, kind, value, active, label, metadata, updated_at)
                            VALUES (%s, 'rfid', %s, TRUE, %s, '{}'::jsonb, now())
                            """,
                            (driver_id, rfid_uid, f"RFID · {payload.get('name') or current[1]}"),
                        )
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"No se pudo asignar la RFID: {e}")

    return {"ok": True, "id": driver_id}


@router.delete("/id/{company_id}/drivers/{driver_id}")
async def delete_company_driver(company_id: int, driver_id: int, _user: CurrentUser = Depends(require_admin)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM public.pin_user WHERE id=%s AND company_id=%s RETURNING id",
                (driver_id, company_id),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="camionero not found")

    return {"ok": True, "id": driver_id}
