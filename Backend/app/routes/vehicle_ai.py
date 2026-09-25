from fastapi import APIRouter, Depends, HTTPException

from datetime import datetime, timezone
import re
from pydantic import BaseModel, Field, field_validator
from psycopg.types.json import Jsonb
from app.db import pool
from app.auth import CurrentUser, require_operator, get_current_user, require_station_access
from app.services.vehicle_ai import analyze_dispatch_vehicle

router = APIRouter(prefix="/ai/vehicle", tags=["vehicle-ai"])


@router.post("/dispatch/{dispatch_id}")
async def analyze_dispatch(dispatch_id: int, _user: CurrentUser = Depends(require_operator)):
    result = await analyze_dispatch_vehicle(dispatch_id)

    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="dispatch not found")

    return {
        "ok": result.get("status") == "ok",
        "dispatch_id": dispatch_id,
        "analysis": result,
    }


class PlateReview(BaseModel):
    plate: str = Field(min_length=1, max_length=20)

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
            await cur.execute("UPDATE public.water_dispatch SET ai_vehicle_analysis=%s WHERE id=%s", (Jsonb(analysis), dispatch_id))
    return {"ok": True, "analysis": analysis}
