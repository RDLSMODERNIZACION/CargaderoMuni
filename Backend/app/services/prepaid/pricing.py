from decimal import Decimal, ROUND_HALF_UP


def calculate_dispatch_amount(
    liters: Decimal,
    price_per_m3: Decimal,
) -> Decimal:
    """
    Calcula el costo de los litros entregados según la tarifa por m³.
    """

    if liters < 0:
        raise ValueError("liters cannot be negative")

    if price_per_m3 <= 0:
        raise ValueError("price_per_m3 must be positive")

    return (
        (liters / Decimal("1000")) * price_per_m3
    ).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )


def calculate_max_affordable_liters(
    balance: Decimal,
    price_per_m3: Decimal,
) -> Decimal:
    """
    Calcula cuántos litros puede pagar una empresa con su saldo.
    """

    if balance < 0:
        raise ValueError("balance cannot be negative")

    if price_per_m3 <= 0:
        raise ValueError("price_per_m3 must be positive")

    return (
        balance / price_per_m3
    ) * Decimal("1000")