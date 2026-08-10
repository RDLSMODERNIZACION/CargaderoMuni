import os
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from app.services.prepaid.pricing import (
    calculate_dispatch_amount,
    calculate_max_affordable_liters,
)


def prepaid_enabled() -> bool:
    """
    Indica si el control de saldo prepago está habilitado.

    Mientras PREPAID_ENABLED=false, el cargadero mantiene
    su comportamiento anterior.
    """

    value = os.getenv("PREPAID_ENABLED", "false")

    return value.lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def authorize_company(
    cursor: Any,
    company_code: str,
) -> dict[str, Any]:
    """
    Verifica si una empresa puede comenzar una carga.

    Con el sistema prepago desactivado:
    - comprueba que la empresa exista;
    - comprueba que esté activa.

    Con el sistema prepago activado:
    - comprueba que tenga una billetera;
    - verifica el saldo mínimo;
    - impide dos cargas activas;
    - calcula los litros máximos posibles.
    """

    if not prepaid_enabled():
        await cursor.execute(
            """
            SELECT
                id,
                name
            FROM public.company
            WHERE code = %s
              AND active
            FOR UPDATE
            """,
            (company_code,),
        )

        row = await cursor.fetchone()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="company not found or inactive",
            )

        return {
            "company_id": int(row[0]),
            "company_name": row[1],
            "prepaid": False,
        }

    await cursor.execute(
        """
        SELECT
            c.id,
            c.name,
            cw.balance,
            cfg.price_per_m3,
            cfg.minimum_balance,
            cfg.currency
        FROM public.company c
        JOIN public.company_wallet cw
          ON cw.company_id = c.id
        CROSS JOIN public.water_billing_config cfg
        WHERE c.code = %s
          AND c.active
          AND cfg.id = 1
        FOR UPDATE OF c, cw
        """,
        (company_code,),
    )

    row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "PREPAID_ACCOUNT_NOT_AVAILABLE",
                "message": (
                    "La empresa no posee una cuenta prepaga activa"
                ),
            },
        )

    company_id = int(row[0])
    company_name = row[1]
    balance = Decimal(row[2])
    price_per_m3 = Decimal(row[3])
    minimum_balance = Decimal(row[4])
    currency = row[5]

    if balance < minimum_balance:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "INSUFFICIENT_MINIMUM_BALANCE",
                "message": (
                    "Saldo insuficiente para iniciar una carga"
                ),
                "balance": float(balance),
                "minimum_balance": float(minimum_balance),
                "currency": currency,
            },
        )

    await cursor.execute(
        """
        SELECT id
        FROM public.water_dispatch
        WHERE company_id = %s
          AND billing_status = 'active'
        LIMIT 1
        """,
        (company_id,),
    )

    active_dispatch = await cursor.fetchone()

    if active_dispatch:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ACTIVE_DISPATCH_EXISTS",
                "message": (
                    "La empresa ya posee una carga activa"
                ),
                "dispatch_id": int(active_dispatch[0]),
            },
        )

    max_affordable_liters = (
        calculate_max_affordable_liters(
            balance=balance,
            price_per_m3=price_per_m3,
        )
    )

    return {
        "company_id": company_id,
        "company_name": company_name,
        "prepaid": True,
        "balance": balance,
        "price_per_m3": price_per_m3,
        "minimum_balance": minimum_balance,
        "currency": currency,
        "max_affordable_liters": max_affordable_liters,
    }


async def insert_dispatch(
    cursor: Any,
    *,
    authorization: dict[str, Any],
    station_id: str,
    photo_path: str | None,
    photo_paths: Any,
    note: str | None,
) -> tuple[Any, ...]:
    """
    Crea un despacho de agua.

    Si el sistema prepago está activado, guarda una copia de:
    - la tarifa vigente;
    - los litros máximos permitidos;
    - el estado activo del despacho.
    """

    if authorization["prepaid"]:
        await cursor.execute(
            """
            INSERT INTO public.water_dispatch (
                station_id,
                company_id,
                photo_path,
                photo_paths,
                note,
                billing_status,
                price_per_m3,
                max_affordable_liters
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                'active',
                %s,
                %s
            )
            RETURNING
                id,
                ts
            """,
            (
                station_id,
                authorization["company_id"],
                photo_path,
                photo_paths,
                note,
                authorization["price_per_m3"],
                authorization["max_affordable_liters"],
            ),
        )

    else:
        await cursor.execute(
            """
            INSERT INTO public.water_dispatch (
                station_id,
                company_id,
                photo_path,
                photo_paths,
                note
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s
            )
            RETURNING
                id,
                ts
            """,
            (
                station_id,
                authorization["company_id"],
                photo_path,
                photo_paths,
                note,
            ),
        )

    row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=500,
            detail="No se pudo crear el despacho",
        )

    return row


async def settle_dispatch(
    cursor: Any,
    dispatch_id: int,
    liters: Decimal,
) -> dict[str, Any]:
    """
    Finaliza un despacho y descuenta el importe correspondiente.

    El despacho, la billetera y el movimiento se actualizan dentro
    de la misma transacción de PostgreSQL.
    """

    await cursor.execute(
        """
        SELECT
            company_id,
            billing_status,
            price_per_m3,
            liters,
            amount
        FROM public.water_dispatch
        WHERE id = %s
        FOR UPDATE
        """,
        (dispatch_id,),
    )

    dispatch = await cursor.fetchone()

    if not dispatch:
        raise HTTPException(
            status_code=404,
            detail="dispatch not found",
        )

    company_id = dispatch[0]
    billing_status = dispatch[1]
    saved_price_per_m3 = dispatch[2]
    saved_liters = dispatch[3]
    saved_amount = dispatch[4]

    if not prepaid_enabled():
        await cursor.execute(
            """
            UPDATE public.water_dispatch
            SET liters = %s
            WHERE id = %s
            """,
            (
                liters,
                dispatch_id,
            ),
        )

        return {
            "amount": None,
            "balance": None,
            "billing_status": billing_status,
        }

    # Permite repetir exactamente la misma notificación sin
    # volver a descontar el saldo.
    if billing_status == "completed":
        if (
            saved_liters is not None
            and Decimal(saved_liters) == liters
        ):
            await cursor.execute(
                """
                SELECT balance
                FROM public.company_wallet
                WHERE company_id = %s
                """,
                (company_id,),
            )

            wallet = await cursor.fetchone()

            return {
                "amount": (
                    Decimal(saved_amount)
                    if saved_amount is not None
                    else None
                ),
                "balance": (
                    Decimal(wallet[0])
                    if wallet
                    else None
                ),
                "billing_status": "completed",
            }

        raise HTTPException(
            status_code=409,
            detail={
                "code": "COMPLETED_DISPATCH_CANNOT_CHANGE",
                "message": (
                    "No se pueden modificar los litros "
                    "de un despacho ya cobrado"
                ),
            },
        )

    if billing_status != "active":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DISPATCH_NOT_ACTIVE",
                "message": (
                    f"El despacho se encuentra {billing_status}"
                ),
            },
        )

    if saved_price_per_m3 is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DISPATCH_WITHOUT_PRICE",
                "message": (
                    "El despacho no posee una tarifa registrada"
                ),
            },
        )

    await cursor.execute(
        """
        SELECT balance
        FROM public.company_wallet
        WHERE company_id = %s
        FOR UPDATE
        """,
        (company_id,),
    )

    wallet = await cursor.fetchone()

    if not wallet:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "COMPANY_WALLET_NOT_FOUND",
                "message": (
                    "No se encontró la cuenta de la empresa"
                ),
            },
        )

    balance = Decimal(wallet[0])
    price_per_m3 = Decimal(saved_price_per_m3)

    amount = calculate_dispatch_amount(
        liters=liters,
        price_per_m3=price_per_m3,
    )

    if amount > balance:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DISPATCH_EXCEEDED_BALANCE",
                "message": (
                    "El costo del despacho supera el saldo"
                ),
                "amount": float(amount),
                "balance": float(balance),
                "requires_manual_review": True,
            },
        )

    new_balance = balance - amount

    await cursor.execute(
        """
        UPDATE public.company_wallet
        SET
            balance = %s,
            updated_at = now()
        WHERE company_id = %s
        """,
        (
            new_balance,
            company_id,
        ),
    )

    await cursor.execute(
        """
        UPDATE public.water_dispatch
        SET
            liters = %s,
            amount = %s,
            billing_status = 'completed',
            debited_at = now()
        WHERE id = %s
        """,
        (
            liters,
            amount,
            dispatch_id,
        ),
    )

    await cursor.execute(
        """
        INSERT INTO public.wallet_movement (
            company_id,
            dispatch_id,
            kind,
            amount,
            balance_after,
            note
        )
        VALUES (
            %s,
            %s,
            'dispatch',
            %s,
            %s,
            %s
        )
        """,
        (
            company_id,
            dispatch_id,
            -amount,
            new_balance,
            "Débito por despacho de agua",
        ),
    )

    return {
        "amount": amount,
        "balance": new_balance,
        "billing_status": "completed",
    }