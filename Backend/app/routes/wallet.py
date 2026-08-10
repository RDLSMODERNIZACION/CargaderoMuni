import os
import secrets
import uuid
from decimal import Decimal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import pool
from app.services.prepaid import (
    calculate_max_affordable_liters,
    prepaid_enabled,
)


router = APIRouter()


class MockTopupIn(BaseModel):
    amount: Decimal = Field(
        ...,
        gt=0,
        decimal_places=2,
    )
    note: str | None = "Recarga de prueba"


def require_admin_key(
    received_key: str | None,
) -> None:
    """
    Protege las operaciones administrativas de saldo.
    """

    expected_key = os.getenv(
        "WALLET_ADMIN_KEY",
        "",
    )

    if not expected_key:
        raise HTTPException(
            status_code=503,
            detail="WALLET_ADMIN_KEY is not configured",
        )

    if not received_key:
        raise HTTPException(
            status_code=401,
            detail="Admin key is required",
        )

    if not secrets.compare_digest(
        received_key,
        expected_key,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid admin key",
        )


def mock_topups_enabled() -> bool:
    """
    Indica si las recargas simuladas están habilitadas.
    """

    value = os.getenv(
        "WALLET_MOCK_TOPUPS_ENABLED",
        "false",
    )

    return value.lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


@router.get("/config")
async def get_billing_config():
    """
    Devuelve la configuración general del sistema prepago.
    """

    async with pool.connection() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT
                    price_per_m3,
                    minimum_balance,
                    currency,
                    updated_at
                FROM public.water_billing_config
                WHERE id = 1
                """
            )

            row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=503,
            detail="Billing configuration not found",
        )

    return {
        "ok": True,
        "prepaid_enabled": prepaid_enabled(),
        "price_per_m3": float(row[0]),
        "minimum_balance": float(row[1]),
        "currency": row[2],
        "updated_at": row[3].isoformat(),
    }


@router.get("/company/{company_code}")
async def get_company_wallet(
    company_code: str,
    x_admin_key: str | None = Header(None),
):
    """
    Devuelve el saldo y la capacidad de carga de una empresa.
    """

    require_admin_key(x_admin_key)

    async with pool.connection() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT
                    c.id,
                    c.name,
                    c.code,
                    c.active,
                    cw.balance,
                    cfg.price_per_m3,
                    cfg.minimum_balance,
                    cfg.currency,
                    cw.updated_at
                FROM public.company c
                JOIN public.company_wallet cw
                  ON cw.company_id = c.id
                CROSS JOIN public.water_billing_config cfg
                WHERE c.code = %s
                  AND cfg.id = 1
                """,
                (company_code,),
            )

            row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Company wallet not found",
        )

    balance = Decimal(row[4])
    price_per_m3 = Decimal(row[5])
    minimum_balance = Decimal(row[6])

    max_affordable_liters = (
        calculate_max_affordable_liters(
            balance=balance,
            price_per_m3=price_per_m3,
        )
    )

    return {
        "ok": True,
        "company_id": int(row[0]),
        "company_name": row[1],
        "company_code": row[2],
        "company_active": bool(row[3]),
        "balance": float(balance),
        "price_per_m3": float(price_per_m3),
        "minimum_balance": float(
            minimum_balance
        ),
        "currency": row[7],
        "can_start": (
            bool(row[3])
            and balance >= minimum_balance
        ),
        "max_affordable_liters": float(
            max_affordable_liters
        ),
        "updated_at": row[8].isoformat(),
    }


@router.get("/company/{company_code}/movements")
async def get_company_movements(
    company_code: str,
    limit: int = 50,
    x_admin_key: str | None = Header(None),
):
    """
    Devuelve los movimientos de saldo de una empresa.
    """

    require_admin_key(x_admin_key)

    safe_limit = max(
        1,
        min(int(limit), 200),
    )

    async with pool.connection() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT
                    wm.id,
                    wm.kind,
                    wm.amount,
                    wm.balance_after,
                    wm.dispatch_id,
                    wm.payment_id,
                    wm.provider,
                    wm.external_reference,
                    wm.note,
                    wm.created_at
                FROM public.wallet_movement wm
                JOIN public.company c
                  ON c.id = wm.company_id
                WHERE c.code = %s
                ORDER BY wm.created_at DESC
                LIMIT %s
                """,
                (
                    company_code,
                    safe_limit,
                ),
            )

            rows = await cursor.fetchall()

    items = []

    for row in rows:
        items.append(
            {
                "id": int(row[0]),
                "kind": row[1],
                "amount": float(row[2]),
                "balance_after": float(row[3]),
                "dispatch_id": row[4],
                "payment_id": row[5],
                "provider": row[6],
                "external_reference": row[7],
                "note": row[8],
                "created_at": row[9].isoformat(),
            }
        )

    return {
        "ok": True,
        "items": items,
    }


@router.post("/company/{company_code}/mock-topup")
async def create_mock_topup(
    company_code: str,
    body: MockTopupIn,
    x_admin_key: str | None = Header(None),
):
    """
    Acredita saldo ficticio para probar el sistema.

    Esta función deberá desactivarse cuando se incorpore
    la acreditación real mediante Pago TIC.
    """

    if not mock_topups_enabled():
        raise HTTPException(
            status_code=404,
            detail="Mock topups are disabled",
        )

    require_admin_key(x_admin_key)

    external_reference = (
        f"mock-{uuid.uuid4()}"
    )

    async with pool.connection() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT id
                FROM public.company
                WHERE code = %s
                  AND active
                FOR UPDATE
                """,
                (company_code,),
            )

            company = await cursor.fetchone()

            if not company:
                raise HTTPException(
                    status_code=404,
                    detail="Company not found or inactive",
                )

            company_id = int(company[0])

            await cursor.execute(
                """
                INSERT INTO public.company_wallet (
                    company_id,
                    balance
                )
                VALUES (
                    %s,
                    %s
                )
                ON CONFLICT (company_id)
                DO UPDATE SET
                    balance = (
                        company_wallet.balance
                        + EXCLUDED.balance
                    ),
                    updated_at = now()
                RETURNING balance
                """,
                (
                    company_id,
                    body.amount,
                ),
            )

            wallet = await cursor.fetchone()

            if not wallet:
                raise HTTPException(
                    status_code=500,
                    detail="Could not update company wallet",
                )

            new_balance = Decimal(wallet[0])

            await cursor.execute(
                """
                INSERT INTO public.wallet_movement (
                    company_id,
                    kind,
                    amount,
                    balance_after,
                    provider,
                    external_reference,
                    note
                )
                VALUES (
                    %s,
                    'topup',
                    %s,
                    %s,
                    'mock',
                    %s,
                    %s
                )
                RETURNING id
                """,
                (
                    company_id,
                    body.amount,
                    new_balance,
                    external_reference,
                    body.note,
                ),
            )

            movement = await cursor.fetchone()

            if not movement:
                raise HTTPException(
                    status_code=500,
                    detail="Could not create wallet movement",
                )

            movement_id = int(movement[0])

    return {
        "ok": True,
        "movement_id": movement_id,
        "company_id": company_id,
        "company_code": company_code,
        "amount": float(body.amount),
        "balance": float(new_balance),
        "external_reference": external_reference,
    }