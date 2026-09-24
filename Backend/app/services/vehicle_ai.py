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

    # Lectura de precision: usamos un modelo de mayor capacidad y dos lecturas
    # independientes. No le mostramos la primera lectura para evitar sesgo de anclaje.
    precision_prompt = (
        "Analiza EXCLUSIVAMENTE la patente del vehiculo visible en estas fotos. "
        "Ignora empresa, modelo, logos y cualquier otro texto. "
        "Acerca visualmente la zona de la chapa y lee caracter por caracter antes de responder. "
        "No uses contexto para completar letras: decide por la forma visible de cada caracter. "
        "Para patente Mercosur argentina el formato es EXACTAMENTE AA999AA: "
        "posiciones 1-2 letras, 3-5 digitos y 6-7 letras. "
        "Tambien puede existir el formato argentino antiguo AAA999. "
        "Presta especial atencion a O/Q/G/C, B/8, I/1, D/O y S/5. "
        "En las posiciones de letras nunca conviertas O en 0 por formato. "
        "Haz una comprobacion visual final de izquierda a derecha antes de responder. "
        "Devuelve la patente sin espacios ni guiones. "
        "Si un caracter sigue siendo realmente ambiguo, indicalo en alternatives y marca review_required. "
        "No inventes una nota diciendo que el formato no coincide si cumple AA999AA o AAA999."
    )

    precision_content: list[dict[str, Any]] = [
        {"type": "input_text", "text": precision_prompt}
    ]
    for url in urls[:4]:
        precision_content.append(
            {
                "type": "input_image",
                "image_url": url,
                "detail": "high",
            }
        )

    async def run_precision(schema_name: str) -> dict[str, Any]:
        try:
            return await _openai_json(
                precision_content,
                schema=PLATE_SCHEMA,
                schema_name=schema_name,
                model=OPENAI_PLATE_MODEL,
                reasoning_effort="high",
            )
        except RuntimeError:
            # Fallback para cuentas/API donde el modelo de precision no esté habilitado.
            return await _openai_json(
                precision_content,
                schema=PLATE_SCHEMA,
                schema_name=schema_name + "_fallback",
                model=OPENAI_VISION_MODEL,
            )

    try:
        plate_review_a = await run_precision("vehicle_plate_precision_a")
        plate_review_b = await run_precision("vehicle_plate_precision_b")
    except RuntimeError as exc:
        analysis["plate_first_pass"] = first_plate
        analysis["plate_second_pass"] = None
        analysis["plate_review_required"] = True
        analysis["plate_review_error"] = str(exc)
        analysis["status"] = "ok"
        analysis["model"] = OPENAI_VISION_MODEL
        analysis["plate_model"] = OPENAI_PLATE_MODEL
        analysis["photo_count"] = len(urls[:4])
        return analysis

    plate_a = _normalize_plate(plate_review_a.get("plate"))
    plate_b = _normalize_plate(plate_review_b.get("plate"))
    conf_a = float(plate_review_a.get("plate_confidence") or 0)
    conf_b = float(plate_review_b.get("plate_confidence") or 0)

    # Si las dos lecturas especializadas coinciden, esa es la lectura de precision.
    # Si discrepan, hacemos una tercera lectura que arbitra mirando nuevamente la imagen.
    if plate_a and plate_a == plate_b and _looks_like_argentine_plate(plate_a):
        plate_review = plate_review_a if conf_a >= conf_b else plate_review_b
        second_plate = plate_a
        second_conf = (conf_a + conf_b) / 2
        precision_consensus = True
        precision_votes = [plate_a, plate_b]
    else:
        tiebreak_prompt = (
            precision_prompt
            + f" Dos lecturas independientes discreparon: A={plate_a or 'null'} y B={plate_b or 'null'}. "
            "No elijas por confianza ni por mayoria: vuelve a mirar la chapa y decide visualmente cual lectura "
            "es correcta o devuelve una tercera lectura si ninguna coincide."
        )
        tiebreak_content: list[dict[str, Any]] = [
            {"type": "input_text", "text": tiebreak_prompt}
        ]
        for url in urls[:4]:
            tiebreak_content.append(
                {
                    "type": "input_image",
                    "image_url": url,
                    "detail": "high",
                }
            )
        try:
            plate_review = await _openai_json(
                tiebreak_content,
                schema=PLATE_SCHEMA,
                schema_name="vehicle_plate_precision_tiebreak",
                model=OPENAI_PLATE_MODEL,
                reasoning_effort="high",
            )
        except RuntimeError:
            plate_review = plate_review_a if conf_a >= conf_b else plate_review_b

        second_plate = _normalize_plate(plate_review.get("plate"))
        second_conf = float(plate_review.get("plate_confidence") or 0)
        precision_votes = [plate_a, plate_b, second_plate]
        precision_consensus = bool(
            second_plate
            and _looks_like_argentine_plate(second_plate)
            and (second_plate == plate_a or second_plate == plate_b)
        )

    first_conf = float(analysis.get("plate_confidence") or 0)
    first_valid = _looks_like_argentine_plate(first_plate)
    second_valid = _looks_like_argentine_plate(second_plate)
    disagreement = bool(first_plate and second_plate and first_plate != second_plate)

    # La lectura especializada manda sobre la lectura general cuando tiene formato válido.
    if second_plate and second_valid:
        final_plate = second_plate
        final_conf = second_conf
    elif first_plate and first_valid:
        final_plate = first_plate
        final_conf = first_conf
    elif second_plate:
        final_plate = second_plate
        final_conf = second_conf
    else:
        final_plate = first_plate
        final_conf = first_conf

    review_required = bool(plate_review.get("review_required"))
    if not precision_consensus:
        review_required = True
    if final_plate and not _looks_like_argentine_plate(final_plate):
        review_required = True

    analysis["plate"] = final_plate
    analysis["plate_confidence"] = final_conf
    analysis["plate_first_pass"] = first_plate
    analysis["plate_first_confidence"] = first_conf
    analysis["plate_second_pass"] = second_plate
    analysis["plate_second_confidence"] = second_conf
    analysis["plate_disagreement"] = disagreement
    analysis["plate_review_required"] = review_required
    analysis["plate_characters"] = plate_review.get("characters", [])
    analysis["plate_review_notes"] = plate_review.get("notes")
    analysis["plate_precision_votes"] = precision_votes
    analysis["plate_precision_consensus"] = precision_consensus
    analysis["status"] = "ok"
    analysis["model"] = OPENAI_VISION_MODEL
    analysis["plate_model"] = OPENAI_PLATE_MODEL
    analysis["photo_count"] = len(urls[:4])
    analysis["analysis_version"] = "plate_precision_v3_sol_consensus"
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
