from fastapi import APIRouter, Depends, HTTPException

from datetime import datetime, timezone
import re
from pydantic import BaseModel, Field, field_validator
from psycopg.types.json import Jsonb
from app.db import pool
from app.auth import CurrentUser, get_current_user, require_station_access
from app.services.vehicle_ai import analyze_dispatch_vehicle
from app.services.vehicle_company import company_check, find_association

router = APIRouter(prefix="/ai/vehicle", tags=["vehicle-ai"])


@router.post("/dispatch/{dispatch_id}")
async def analyze_dispatch(dispatch_id: int, user: CurrentUser = Depends(get_current_user)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT station_id FROM public.water_dispatch WHERE id=%s", (dispatch_id,))
            row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "dispatch not found")
    await require_station_access(user, str(row[0]), {"owner", "admin", "operator"})
    result = await analyze_dispatch_vehicle(dispatch_id)

    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="dispatch not found")

    return {
        "ok": result.get("status") == "ok" and not result.get("last_analysis_error"),
        "dispatch_id": dispatch_id,
        "analysis": result,
    }


class PlateReview(BaseModel):
    plate: str = Field(min_length=1, max_length=20)
    company_id: int | None = Field(default=None, gt=0)
    # Optimistic check prevents silently replacing an existing association.
    previous_company_id: int | None = Field(default=None, gt=0)

    @field_validator("plate")
    @classmethod
    def valid_plate(cls, value: str) -> str:
        value = re.sub(r"[\s-]", "", value.upper())
        if not re.fullmatch(r"(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})", value):
            raise ValueError("Usá formato ABC123 o AB123CD")
        return value


@router.patch("/dispatch/{dispatch_id}/plate")
async def validate_plate(dispatch_id: int, body: PlateReview,
                         user: CurrentUser = Depends(get_current_user)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT station_id FROM public.water_dispatch WHERE id=%s", (dispatch_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "dispatch not found")
            await require_station_access(user, str(row[0]), {"owner", "admin", "operator"})
            await cur.execute("SELECT ai_vehicle_analysis FROM public.water_dispatch WHERE id=%s FOR UPDATE", (dispatch_id,))
            current = await cur.fetchone()
            if not current:
                raise HTTPException(404, "dispatch not found")
            analysis = dict(current[0] or {})
            review = {"plate": body.plate, "previous_plate": analysis.get("plate"),
                      "validated_by": user.id, "validator": user.email or user.id,
                      "validated_at": datetime.now(timezone.utc).isoformat()}
            analysis.setdefault("plate_first_pass", analysis.get("plate"))
            analysis["plate_reviews"] = [*analysis.get("plate_reviews", []), review]
            analysis.update(plate=body.plate, plate_validation=review,
                            plate_review_required=False)
            if body.company_id is not None:
                await cur.execute("""
                    SELECT s.organization_id, wd.company_id, wd.debited_at
                    FROM public.water_dispatch wd JOIN public.station s ON s.id=wd.station_id
                    WHERE wd.id=%s
                """, (dispatch_id,))
                organization_id, old_company_id, debited_at = await cur.fetchone()
                if organization_id is None:
                    raise HTTPException(409, "La estación debe tener una organización asignada")
                if debited_at and old_company_id != body.company_id:
                    raise HTTPException(409, "No se puede cambiar la empresa de un despacho ya debitado")
                await cur.execute("""
                    SELECT c.name FROM public.company c
                    JOIN public.station_company_access sca ON sca.company_id=c.id
                    WHERE sca.station_id=%s AND c.id=%s AND c.active AND sca.active
                """, (str(row[0]), body.company_id))
                company = await cur.fetchone()
                if not company:
                    raise HTTPException(403, "Empresa no habilitada para esta estación")
                # Serialize the first association too (there may be no row to lock yet).
                await cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                                  (f"vehicle_company:{organization_id}:{body.plate}",))
                await cur.execute("SELECT company_id FROM public.vehicle_company WHERE organization_id=%s AND plate=%s FOR UPDATE",
                                  (organization_id, body.plate))
                existing = await cur.fetchone()
                previous_id = existing[0] if existing else None
                if previous_id != body.previous_company_id:
                    raise HTTPException(409, "La asociación cambió o pertenece a otra empresa; recargá y revisá antes de reemplazarla")
                company_review = {"plate": body.plate, "company_id": body.company_id,
                    "company_name": company[0], "previous_company_id": old_company_id,
                    "previous_association_company_id": previous_id,
                    "validated_by": user.id, "validator": user.email or user.id,
                    "validated_at": review["validated_at"]}
                await cur.execute("""
                    INSERT INTO public.vehicle_company (organization_id, plate, company_id, updated_by, history)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (organization_id, plate) DO UPDATE SET company_id=EXCLUDED.company_id,
                        updated_at=now(), updated_by=EXCLUDED.updated_by,
                        history=vehicle_company.history || EXCLUDED.history
                """, (organization_id, body.plate, body.company_id, user.id, Jsonb([company_review])))
                analysis["company_validation"] = company_review
                analysis["company_reviews"] = [*analysis.get("company_reviews", []), company_review]
                await cur.execute("UPDATE public.water_dispatch SET company_id=%s WHERE id=%s", (body.company_id, dispatch_id))
            association = await find_association(cur, str(row[0]), body.plate)
            await cur.execute("SELECT c.name FROM public.water_dispatch wd LEFT JOIN public.company c ON c.id=wd.company_id WHERE wd.id=%s", (dispatch_id,))
            company_row = await cur.fetchone()
            analysis = company_check(analysis, association, (analysis.get("company_validation") or {}).get("company_name"))
            await cur.execute("UPDATE public.water_dispatch SET ai_vehicle_analysis=%s WHERE id=%s", (Jsonb(analysis), dispatch_id))
    return {"ok": True, "analysis": analysis}


@router.get("/dispatch/{dispatch_id}/company-context")
async def company_context(dispatch_id: int, plate: str = "", user: CurrentUser = Depends(get_current_user)):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT station_id FROM public.water_dispatch WHERE id=%s", (dispatch_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "dispatch not found")
            await require_station_access(user, str(row[0]))
            normalized = re.sub(r"[\s-]", "", plate.upper())
            if normalized and not re.fullmatch(r"(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})", normalized):
                raise HTTPException(422, "Patente inválida")
            association = await find_association(cur, str(row[0]), normalized)
            await cur.execute("""
                SELECT c.id, c.name FROM public.company c
                JOIN public.station_company_access sca ON sca.company_id=c.id
                WHERE sca.station_id=%s AND sca.active AND c.active ORDER BY c.name
            """, (str(row[0]),))
            companies = [{"id": r[0], "name": r[1]} for r in await cur.fetchall()]
    return {"association": association, "companies": companies}
