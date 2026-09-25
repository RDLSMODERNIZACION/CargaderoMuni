from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import httpx
from psycopg.types.json import Jsonb

from app.db import pool

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-5.4-mini")
OPENAI_PLATE_MODEL = os.getenv("OPENAI_PLATE_MODEL", "gpt-5.6-sol")

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

PLATE_SCHEMA = {
    "type": "object",
    "properties": {
        "plate": {"type": ["string", "null"]},
        "plate_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "review_required": {"type": "boolean"},
        "characters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "value": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "alternatives": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["value", "confidence", "alternatives"],
                "additionalProperties": False,
            },
        },
        "notes": {"type": ["string", "null"]},
    },
    "required": [
        "plate",
        "plate_confidence",
        "review_required",
        "characters",
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


def _normalize_plate(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"[^A-Z0-9]", "", value.upper())
    return normalized or None


def _looks_like_argentine_plate(value: Optional[str]) -> bool:
    if not value:
        return False
    return bool(
        re.fullmatch(r"[A-Z]{2}[0-9]{3}[A-Z]{2}", value)
        or re.fullmatch(r"[A-Z]{3}[0-9]{3}", value)
    )


async def _openai_json(
    content: list[dict[str, Any]],
    *,
    schema: dict[str, Any],
    schema_name: str,
    model: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
) -> dict[str, Any]:
    selected_model = model or OPENAI_VISION_MODEL
    body = {
        "model": selected_model,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "strict": True,
                "schema": schema,
            }
        },
    }
    if reasoning_effort:
        body["reasoning"] = {"effort": reasoning_effort}

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=75) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers=headers,
            json=body,
        )

    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI {response.status_code}: {response.text[:500]}")

    output_text = _extract_output_text(response.json())
    if not output_text:
        raise RuntimeError("OpenAI response without output_text")

    try:
        return json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI returned invalid JSON") from exc


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

    first_prompt = (
        "Analiza las fotos de un camion/cisterna en un cargadero de agua municipal de Argentina. "
        "Extrae solamente informacion visible, sin inferir propietario por marca/modelo. "
        "Lee la patente argentina si es legible (formatos actuales o antiguos) y normalizala sin espacios ni guiones. "
        "Busca razon social, nombre comercial, logo o texto de empresa pintado/pegado en cabina, tanque, puerta o acoplado. "
        "Si no se ve con suficiente claridad, devuelve null. "
        "matches_expected_company compara exclusivamente el texto/logo visible contra la empresa esperada; "
        "si no hay evidencia visible suficiente devuelve null. "
        f"Empresa esperada por credencial/PIN: {expected_company or 'desconocida'}."
    )

    first_content: list[dict[str, Any]] = [{"type": "input_text", "text": first_prompt}]
    for url in urls[:4]:
        first_content.append(
            {
                "type": "input_image",
                "image_url": url,
                "detail": "high",
            }
        )

    try:
        analysis = await _openai_json(
            first_content,
            schema=VEHICLE_SCHEMA,
            schema_name="vehicle_photo_analysis",
        )
    except RuntimeError as exc:
        return {"status": "error", "error": str(exc)}

    first_plate = _normalize_plate(analysis.get("plate"))
    analysis["plate"] = first_plate

    # La patente se conserva tal como la devuelve el primer análisis.
    # La IA funciona como ayuda visual; la confirmación/corrección es manual.
    first_conf = float(analysis.get("plate_confidence") or 0)
    analysis["plate"] = first_plate
    analysis["plate_confidence"] = first_conf
    analysis["plate_first_pass"] = first_plate
    analysis["plate_first_confidence"] = first_conf
    analysis["plate_second_pass"] = None
    analysis["plate_second_confidence"] = None
    analysis["plate_disagreement"] = False
    analysis["plate_review_required"] = bool(first_plate)
    analysis["plate_characters"] = []
    analysis["plate_review_notes"] = (
        "Lectura automática inicial. Confirmar visualmente la patente con la foto antes de usarla como dato definitivo."
        if first_plate
        else "No se detectó una patente legible. Revisar manualmente las fotos."
    )
    analysis["status"] = "ok"
    analysis["model"] = OPENAI_VISION_MODEL
    analysis["photo_count"] = len(urls[:4])
    analysis["analysis_version"] = "plate_first_pass_manual_review_v1"
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
                SET ai_vehicle_analysis = %s::jsonb ||
                    CASE WHEN ai_vehicle_analysis ? 'plate_validation' THEN
                      jsonb_build_object('plate', ai_vehicle_analysis->'plate',
                        'plate_validation', ai_vehicle_analysis->'plate_validation',
                        'plate_reviews', ai_vehicle_analysis->'plate_reviews',
                        'plate_review_required', false)
                    ELSE '{}'::jsonb END
                WHERE id = %s
                """,
                (Jsonb(result), dispatch_id),
            )

    return result
