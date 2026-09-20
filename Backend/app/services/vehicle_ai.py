from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx
from psycopg.types.json import Jsonb

from app.db import pool

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-5.4-mini")

VEHICLE_SCHEMA = {
    "type": "object",
    "properties": {
        "plate": {"type": ["string", "null"]},
        "plate_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "company_visible": {"type": ["string", "null"]},
        "company_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "matches_expected_company": {"type": ["boolean", "null"]},
        "match_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "vehicle_type": {"type": ["string", "null"]},
        "visible_text": {
            "type": "array",
            "items": {"type": "string"},
        },
        "notes": {"type": ["string", "null"]},
    },
    "required": [
        "plate",
        "plate_confidence",
        "company_visible",
        "company_confidence",
        "matches_expected_company",
        "match_confidence",
        "vehicle_type",
        "visible_text",
        "notes",
    ],
    "additionalProperties": False,
}


def _extract_output_text(payload: dict[str, Any]) -> str:
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    return ""


async def analyze_vehicle_images(
    photo_urls: list[str],
    *,
    expected_company: Optional[str] = None,
) -> dict[str, Any]:
    if not OPENAI_API_KEY:
        return {
            "status": "not_configured",
            "error": "OPENAI_API_KEY missing",
        }

    urls = [u for u in photo_urls if isinstance(u, str) and u.strip()]
    if not urls:
        return {
            "status": "no_photos",
            "error": "No photos available",
        }

    prompt = (
        "Analiza las fotos de un camion/cisterna en un cargadero de agua municipal de Argentina. "
        "Extrae solamente informacion visible, sin inferir propietario por marca/modelo. "
        "Lee la patente argentina si es legible (formatos actuales o antiguos) y normalizala sin espacios ni guiones. "
        "Busca razon social, nombre comercial, logo o texto de empresa pintado/pegado en cabina, tanque, puerta o acoplado. "
        "Si no se ve con suficiente claridad, devuelve null. "
        "matches_expected_company compara exclusivamente el texto/logo visible contra la empresa esperada; "
        "si no hay evidencia visible suficiente devuelve null. "
        f"Empresa esperada por credencial/PIN: {expected_company or 'desconocida'}."
    )

    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    for url in urls[:4]:
        content.append(
            {
                "type": "input_image",
                "image_url": url,
                "detail": "high",
            }
        )

    body = {
        "model": OPENAI_VISION_MODEL,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "vehicle_photo_analysis",
                "strict": True,
                "schema": VEHICLE_SCHEMA,
            }
        },
    }

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers=headers,
            json=body,
        )

    if response.status_code >= 400:
        return {
            "status": "error",
            "error": f"OpenAI {response.status_code}: {response.text[:500]}",
        }

    raw = response.json()
    output_text = _extract_output_text(raw)
    if not output_text:
        return {
            "status": "error",
            "error": "OpenAI response without output_text",
        }

    try:
        analysis = json.loads(output_text)
    except json.JSONDecodeError:
        return {
            "status": "error",
            "error": "OpenAI returned invalid JSON",
        }

    analysis["status"] = "ok"
    analysis["model"] = OPENAI_VISION_MODEL
    analysis["photo_count"] = len(urls[:4])
    return analysis


async def analyze_dispatch_vehicle(dispatch_id: int) -> dict[str, Any]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT wd.photo_paths, wd.photo_path, c.name
                FROM public.water_dispatch wd
                LEFT JOIN public.company c ON c.id = wd.company_id
                WHERE wd.id = %s
                """,
                (dispatch_id,),
            )
            row = await cur.fetchone()

    if not row:
        return {"status": "not_found", "error": "dispatch not found"}

    photo_paths = row[0] if isinstance(row[0], list) else []
    if not photo_paths and row[1]:
        photo_paths = [row[1]]

    result = await analyze_vehicle_images(
        photo_paths,
        expected_company=row[2],
    )

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.water_dispatch
                SET ai_vehicle_analysis = %s
                WHERE id = %s
                """,
                (Jsonb(result), dispatch_id),
            )

    return result
