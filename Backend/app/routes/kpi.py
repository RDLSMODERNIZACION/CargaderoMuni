# app/routes/kpi.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Query
from app.db import get_conn

router = APIRouter(prefix="/kpi", tags=["kpi"])


# -----------------------------
# Helpers
# -----------------------------
def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    """
    Acepta ISO8601 (con o sin Z). Si es naive, la asume UTC.
    """
    if not s:
        return None
    ss = s.strip()
    if not ss:
        return None
    # soportar "Z"
    if ss.endswith("Z"):
        ss = ss[:-1] + "+00:00"
    dt = datetime.fromisoformat(ss)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _build_where(
    *,
    dt_from: Optional[datetime],
    dt_to: Optional[datetime],
    station_id: Optional[str],
    company_id: Optional[int],
) -> Tuple[str, List[Any]]:
    where: List[str] = []
    params: List[Any] = []

    # ts range
    if dt_from is not None:
        where.append("wd.ts >= %s")
        params.append(dt_from)
    if dt_to is not None:
        where.append("wd.ts < %s")
        params.append(dt_to)

    # filters
    if station_id:
        where.append("wd.station_id = %s")
        params.append(station_id)

    if company_id is not None:
        where.append("wd.company_id = %s")
        params.append(company_id)

    if where:
        return "WHERE " + " AND ".join(where), params
    return "", params


# -----------------------------
# KPI: Summary
# -----------------------------
@router.get("/summary")
async def kpi_summary(
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    station_id: Optional[str] = None,
    company_id: Optional[int] = None,
):
    """
    Resumen KPI:
      - total_liters
      - dispatch_count
      - companies_count (distinct company_id)
      - stations_count (distinct station_id)

    Params:
      from, to: ISO8601 (ej: 2026-01-01T00:00:00Z)
      station_id, company_id: opcionales
    """
    dt_from = _parse_dt(from_ts)
    dt_to = _parse_dt(to_ts)

    where_sql, params = _build_where(
        dt_from=dt_from,
        dt_to=dt_to,
        station_id=station_id,
        company_id=company_id,
    )

    sql = f"""
        SELECT
          COALESCE(SUM(COALESCE(wd.liters, 0)), 0) AS total_liters,
          COUNT(*)::bigint AS dispatch_count,
          COUNT(DISTINCT wd.company_id)::bigint AS companies_count,
          COUNT(DISTINCT wd.station_id)::bigint AS stations_count
        FROM public.water_dispatch wd
        {where_sql}
    """

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, tuple(params))
            row = await cur.fetchone()

    return {
        "ok": True,
        "filters": {
            "from": dt_from.isoformat() if dt_from else None,
            "to": dt_to.isoformat() if dt_to else None,
            "station_id": station_id,
            "company_id": company_id,
        },
        "total_liters": float(row[0] or 0),
        "dispatch_count": int(row[1] or 0),
        "companies_count": int(row[2] or 0),
        "stations_count": int(row[3] or 0),
    }


# -----------------------------
# KPI: By Company
# -----------------------------
@router.get("/by_company")
async def kpi_by_company(
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    station_id: Optional[str] = None,
    top: int = 50,
):
    """
    Ranking / agregación por empresa (company):
      - company_id, company_name, company_code
      - liters
      - dispatch_count

    Params:
      from, to: ISO8601
      station_id: opcional
      top: límite (max 500)
    """
    dt_from = _parse_dt(from_ts)
    dt_to = _parse_dt(to_ts)
    top = max(1, min(int(top), 500))

    # acá NO filtramos por company_id porque justamente agrupamos por company
    where_sql, params = _build_where(
        dt_from=dt_from,
        dt_to=dt_to,
        station_id=station_id,
        company_id=None,
    )

    sql = f"""
        SELECT
          wd.company_id,
          c.name AS company_name,
          c.code AS company_code,
          COALESCE(SUM(COALESCE(wd.liters, 0)), 0) AS liters,
          COUNT(*)::bigint AS dispatch_count
        FROM public.water_dispatch wd
        LEFT JOIN public.company c ON c.id = wd.company_id
        {where_sql}
        GROUP BY wd.company_id, c.name, c.code
        ORDER BY liters DESC
        LIMIT %s
    """
    params2 = list(params) + [top]

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, tuple(params2))
            rows = await cur.fetchall()

    items: List[Dict[str, Any]] = []
    for r in rows:
        items.append(
            {
                "company_id": r[0],
                "company_name": r[1],
                "company_code": r[2],
                "liters": float(r[3] or 0),
                "dispatch_count": int(r[4] or 0),
            }
        )

    return {
        "ok": True,
        "filters": {
            "from": dt_from.isoformat() if dt_from else None,
            "to": dt_to.isoformat() if dt_to else None,
            "station_id": station_id,
            "top": top,
        },
        "items": items,
    }


# -----------------------------
# KPI: By Station
# -----------------------------
@router.get("/by_station")
async def kpi_by_station(
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    company_id: Optional[int] = None,
    top: int = 50,
):
    """
    Ranking / agregación por estación:
      - station_id, station_name
      - liters
      - dispatch_count

    Params:
      from, to: ISO8601
      company_id: opcional
      top: límite (max 500)
    """
    dt_from = _parse_dt(from_ts)
    dt_to = _parse_dt(to_ts)
    top = max(1, min(int(top), 500))

    # acá NO filtramos por station_id porque agrupamos por estación
    where_sql, params = _build_where(
        dt_from=dt_from,
        dt_to=dt_to,
        station_id=None,
        company_id=company_id,
    )

    sql = f"""
        SELECT
          wd.station_id,
          s.name AS station_name,
          COALESCE(SUM(COALESCE(wd.liters, 0)), 0) AS liters,
          COUNT(*)::bigint AS dispatch_count
        FROM public.water_dispatch wd
        LEFT JOIN public.station s ON s.id = wd.station_id
        {where_sql}
        GROUP BY wd.station_id, s.name
        ORDER BY liters DESC
        LIMIT %s
    """
    params2 = list(params) + [top]

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, tuple(params2))
            rows = await cur.fetchall()

    items: List[Dict[str, Any]] = []
    for r in rows:
        items.append(
            {
                "station_id": r[0],
                "station_name": r[1] or r[0],
                "liters": float(r[2] or 0),
                "dispatch_count": int(r[3] or 0),
            }
        )

    return {
        "ok": True,
        "filters": {
            "from": dt_from.isoformat() if dt_from else None,
            "to": dt_to.isoformat() if dt_to else None,
            "company_id": company_id,
            "top": top,
        },
        "items": items,
    }
