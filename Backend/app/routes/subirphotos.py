# app/routes/subirphotos.py
# Subida de fotos de la cámara a Supabase Storage + registro en public.photo
# Endpoints (solo SUBIDA):
#   - POST /photos/upload        (multipart: archivo)
#   - POST /photos/fetch         (JSON: snapshot_url + auth opcional)
#   - POST /photos/fetch-camera  (usa ENVs de cámara: CAMERA_* )
#
# ENVs esperadas:
#   # DB (usada por app.db)
#   DATABASE_URL  (o SUPABASE_DB_URL con app/db.py adaptado)
#
#   # Storage Supabase
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service role>   (o SUPABASE_SERVICE_ROLE)
#   SUPABASE_BUCKET_PHOTOS=<bucket>            (o STORAGE_BUCKET)
#   STORAGE_PREFIX=<prefijo dentro del bucket, default "photos">  # ej: "cargadero"
#
#   # Cámara (para /photos/fetch-camera)
#   CAMERA_SNAPSHOT_URL=<URL>
#   CAMERA_AUTH=basic|digest     (default: basic)
#   CAMERA_USER=<usuario>
#   CAMERA_PASS=<password>

import os
import json
import secrets
import datetime as dt
from typing import Optional

import httpx
from httpx import DigestAuth
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from app.db import get_conn

router = APIRouter(prefix="/photos", tags=["photos"])

# Prefijo opcional dentro del bucket (carpeta raíz lógica)
STORAGE_PREFIX = os.getenv("STORAGE_PREFIX", "photos")


# ---------------------- Helpers de tiempo/nombre ----------------------
def _now_utc():
    return dt.datetime.now(dt.timezone.utc)

def _ts_for_name(ts: dt.datetime) -> str:
    return ts.strftime("%Y%m%dT%H%M%S")

def _build_storage_path(dispatch_id: int, ext: str = "jpg") -> str:
    """
    NUEVO: guarda como <STORAGE_PREFIX>/disp_<ID>/snap_<YYYYMMDDTHHMMSS>_<rand>.<ext>
    Ej.: cargadero/disp_2/snap_20251018T203049_03809251.jpg
    """
    ts = _now_utc()
    rnd = secrets.token_hex(4)
    return f"{STORAGE_PREFIX}/disp_{dispatch_id}/snap_{_ts_for_name(ts)}_{rnd}.{ext}"


# ---------------------- Helpers de Storage ----------------------
def _get_storage_env():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE")
    bucket = os.getenv("SUPABASE_BUCKET_PHOTOS") or os.getenv("STORAGE_BUCKET") or "photos"
    if not url or not key:
        raise HTTPException(status_code=500, detail="Storage no configurado: faltan SUPABASE_URL o SERVICE_ROLE")
    return url.rstrip("/"), key, bucket

def _public_url(path: str) -> str:
    url, _, bucket = _get_storage_env()
    return f"{url}/storage/v1/object/public/{bucket}/{path}"

async def _signed_url(path: str, expires_in: int = 3600) -> Optional[str]:
    url, key, bucket = _get_storage_env()
    api = f"{url}/storage/v1/object/sign/{bucket}/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(api, headers={"Authorization": f"Bearer {key}"}, json={"expiresIn": expires_in})
        if r.status_code // 100 != 2:
            return None
        data = r.json()
        signed = data.get("signedURL") or data.get("signedUrl")
        if not signed:
            return None
        return signed if signed.startswith("http") else f"{url}{signed}"

async def _upload_to_storage(path: str, content: bytes, content_type: str = "image/jpeg") -> None:
    url, key, bucket = _get_storage_env()
    api = f"{url}/storage/v1/object/{bucket}/{path}"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(api, headers=headers, content=content)
        if r.status_code // 100 != 2:
            raise HTTPException(status_code=502, detail=f"Error subiendo a storage: {r.status_code} {r.text}")


# ---------------------- Helpers DB ----------------------
def _ensure_dispatch(dispatch_id: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM public.dispatch WHERE id=%s", (dispatch_id,))
        if not cur.fetchone():
            raise HTTPException(404, f"Dispatch {dispatch_id} no existe")

def _insert_photo(dispatch_id: int, camera_id: Optional[str], storage_path: str, meta: Optional[dict]) -> dict:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.photo (dispatch_id, camera_id, storage_path, meta)
            VALUES (%s, %s, %s, %s)
            RETURNING id, dispatch_id, ts, camera_id, storage_path, meta
            """,
            (dispatch_id, camera_id, storage_path, json.dumps(meta) if meta is not None else None)
        )
        r = cur.fetchone()
        return {
            "id": r[0],
            "dispatch_id": r[1],
            "ts": r[2].isoformat(),
            "camera_id": r[3],
            "storage_path": r[4],
            "meta": r[5],
        }


# ---------------------- ENVs de Cámara ----------------------
def _get_camera_env():
    auth_kind = (os.getenv("CAMERA_AUTH", "basic") or "basic").lower()  # "basic" | "digest"
    user = os.getenv("CAMERA_USER")
    pwd  = os.getenv("CAMERA_PASS")
    url  = os.getenv("CAMERA_SNAPSHOT_URL")
    if not url:
        raise HTTPException(status_code=500, detail="Falta CAMERA_SNAPSHOT_URL")
    # auth opcional (algunas cámaras permiten snapshot sin auth)
    if user and pwd:
        if auth_kind == "digest":
            auth = DigestAuth(user, pwd)
        else:
            auth = (user, pwd)  # Basic
    else:
        auth = None
    return url, auth


# ---------------------- Schemas ----------------------
class FetchReq(BaseModel):
    dispatch_id: int
    snapshot_url: str
    camera_id: Optional[str] = None
    # 'basic' | 'digest' (default: basic). Si no se envía, se usa basic.
    auth: Optional[str] = None
    basic_user: Optional[str] = None
    basic_pass: Optional[str] = None
    meta: Optional[dict] = None
    # hint de content-type si la cámara no lo manda
    content_type_hint: Optional[str] = None

class PhotoOut(BaseModel):
    id: int
    dispatch_id: int
    ts: str
    camera_id: Optional[str]
    storage_path: str
    public_url: Optional[str] = None
    signed_url: Optional[str] = None
    meta: Optional[dict] = None


# ======================================================================
#                                ENDPOINTS
# ======================================================================

@router.post("/upload", response_model=PhotoOut)
async def upload_photo(
    dispatch_id: int = Form(...),
    camera_id: Optional[str] = Form(None),
    meta: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    """
    Sube un archivo (multipart) y lo guarda en Supabase Storage.
    Registra el row en public.photo.
    """
    _ensure_dispatch(dispatch_id)

    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")

    ctype = (file.content_type or "image/jpeg").lower()
    ext = "jpg"
    if "png" in ctype:
        ext = "png"
    elif "webp" in ctype:
        ext = "webp"
    elif "jpeg" in ctype or "jpg" in ctype:
        ext = "jpg"

    storage_path = _build_storage_path(dispatch_id, ext)
    await _upload_to_storage(storage_path, content, content_type=ctype)

    meta_obj = None
    if meta:
        try:
            meta_obj = json.loads(meta)
        except Exception:
            meta_obj = {"_raw": meta}

    row = _insert_photo(dispatch_id, camera_id, storage_path, meta_obj)
    return PhotoOut(
        **row,
        public_url=_public_url(storage_path),
        signed_url=await _signed_url(storage_path, expires_in=60*60*24*30)  # 30 días
    )


@router.post("/fetch", response_model=PhotoOut)
async def fetch_photo(req: FetchReq):
    """
    Descarga un snapshot (HTTP/HTTPS) desde la cámara y lo sube a Supabase Storage.
    - Soporta auth BASIC (user/pass) y DIGEST (req.auth='digest').
    """
    _ensure_dispatch(req.dispatch_id)

    auth = None
    if req.basic_user and req.basic_pass:
        if (req.auth or "basic").lower() == "digest":
            auth = DigestAuth(req.basic_user, req.basic_pass)
        else:
            auth = (req.basic_user, req.basic_pass)

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(req.snapshot_url, auth=auth)
        if r.status_code // 100 != 2:
            raise HTTPException(502, f"No se pudo bajar snapshot: {r.status_code}")
        content = r.content
        if not content:
            raise HTTPException(502, "Snapshot vacío")

        ctype = (req.content_type_hint or r.headers.get("Content-Type", "image/jpeg")).lower()
        ext = "jpg"
        if "png" in ctype:
            ext = "png"
        elif "webp" in ctype:
            ext = "webp"
        elif "jpeg" in ctype or "jpg" in ctype:
            ext = "jpg"

    storage_path = _build_storage_path(req.dispatch_id, ext)
    await _upload_to_storage(storage_path, content, content_type=ctype)

    row = _insert_photo(req.dispatch_id, req.camera_id, storage_path, req.meta)
    return PhotoOut(
        **row,
        public_url=_public_url(storage_path),
        signed_url=await _signed_url(storage_path, expires_in=60*60*24*30)
    )


@router.post("/fetch-camera", response_model=PhotoOut)
async def fetch_camera(
    dispatch_id: int = Form(...),
    camera_id: Optional[str] = Form("HIK-01"),
    meta: Optional[str] = Form(None),
):
    """
    Baja snapshot usando SOLO ENVs:
      CAMERA_SNAPSHOT_URL, CAMERA_AUTH (basic|digest), CAMERA_USER, CAMERA_PASS
    Sube a Storage y registra en public.photo.
    """
    _ensure_dispatch(dispatch_id)

    snapshot_url, auth = _get_camera_env()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(snapshot_url, auth=auth)
        if r.status_code // 100 != 2:
            raise HTTPException(502, f"No se pudo bajar snapshot: {r.status_code}")
        content = r.content
        if not content:
            raise HTTPException(502, "Snapshot vacío")

        ctype = (r.headers.get("Content-Type", "image/jpeg") or "image/jpeg").lower()
        ext = "jpg"
        if "png" in ctype:
            ext = "png"
        elif "webp" in ctype:
            ext = "webp"
        elif "jpeg" in ctype or "jpg" in ctype:
            ext = "jpg"

    storage_path = _build_storage_path(dispatch_id, ext)
    await _upload_to_storage(storage_path, content, content_type=ctype)

    meta_obj = None
    if meta:
        try:
            meta_obj = json.loads(meta)
        except Exception:
            meta_obj = {"_raw": meta}

    row = _insert_photo(dispatch_id, camera_id, storage_path, meta_obj)
    return PhotoOut(
        **row,
        public_url=_public_url(storage_path),
        signed_url=await _signed_url(storage_path, expires_in=60*60*24*30)
    )
