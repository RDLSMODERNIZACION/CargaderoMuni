from fastapi import APIRouter, Depends, HTTPException

from app.auth import CurrentUser, require_operator
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
