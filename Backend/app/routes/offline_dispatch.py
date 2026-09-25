"""Historical receipts from the station's persistent outbox; no relay control."""
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict, model_validator
from psycopg.types.json import Jsonb
from app.db import pool
from app.routes.water import _upload_bytes_to_supabase, _public_url
from app.services.vehicle_ai import analyze_dispatch_vehicle

router = APIRouter(prefix="/water/offline", tags=["water"])


class Photo(BaseModel):
    sha: str = Field(pattern=r"^[a-f0-9]{64}$")
    mime: Literal['image/jpeg', 'image/png']


class Receipt(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    local_id: uuid.UUID
    station_id: str = Field(min_length=1, max_length=64)
    revision: int = Field(ge=1)
    started_at: datetime
    ended_at: datetime | None = None
    employee_no: str = Field(default='', max_length=64)
    card_no: str = Field(default='', max_length=128)
    company_code: str = Field(default='', max_length=64)
    pin_user_id: int | None = None
    access_method: Literal['rfid', 'company_pin', 'manual']
    roster_generated_at: datetime | None = None
    liters: float | None = Field(default=None, ge=0, le=1e9)
    flow_l_min: float | None = Field(default=None, gt=0, le=1e6)
    meter_method: Literal['time_estimate', 'timestamps']
    pump_started_at: datetime | None = None
    review_reasons: list[str] = Field(default_factory=list, max_length=30)
    photos: list[Photo] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def valid_times(self):
        for d in [self.started_at, self.ended_at, self.roster_generated_at, self.pump_started_at]:
            if d and d.tzinfo is None:
                raise ValueError('Las fechas deben incluir zona horaria')
        if self.ended_at and self.ended_at < self.started_at:
            raise ValueError('Fin anterior al inicio')
        if self.started_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('Reloj de la estación adelantado')
        if self.meter_method == 'time_estimate' and (self.liters is None or self.flow_l_min is None):
            raise ValueError('Registro anterior sin volumen')
        if self.meter_method == 'timestamps' and (self.liters is not None or self.flow_l_min is not None):
            raise ValueError('El registro de horarios no debe enviar litros ni caudal')
        if self.pump_started_at and (self.pump_started_at < self.started_at or (self.ended_at and self.pump_started_at > self.ended_at)):
            raise ValueError('Inicio de bomba fuera del intervalo')
        if any(len(x)>200 for x in self.review_reasons):
            raise ValueError('Motivo de revisión demasiado largo')
        if len({p.sha for p in self.photos})!=len(self.photos):
            raise ValueError('Fotos duplicadas')
        return self


def digest(receipt):
    return hashlib.sha256(json.dumps(receipt.model_dump(mode='json', exclude={'pump_started_at'} if receipt.meter_method == 'time_estimate' else set()), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def check_revision(old, r, fingerprint):
    """old = id,station,revision,meta,liters,end,ts,photo_paths."""
    if not old:
        return False
    if old[1] != r.station_id:
        raise HTTPException(409, 'UUID usado por otra estación')
    if old[2] >= r.revision:
        if old[2] == r.revision and old[3].get('digest') != fingerprint:
            raise HTTPException(409, 'Misma revisión con contenido diferente')
        return True
    if old[6] != r.started_at:
        raise HTTPException(409, 'No se puede cambiar el inicio de una carga')
    if old[3].get('meter_method', 'time_estimate') != r.meter_method:
        raise HTTPException(409, 'No se puede cambiar el método de registro')
    prior_pump = old[3].get('pump_started_at')
    if prior_pump and (not r.pump_started_at or datetime.fromisoformat(prior_pump.replace('Z', '+00:00')) != r.pump_started_at):
        raise HTTPException(409, 'No se puede cambiar el inicio de bomba')
    prior_liters = old[3].get('liters', old[4])
    if r.meter_method == 'time_estimate' and float(prior_liters or 0) > r.liters:
        raise HTTPException(409, 'Una revisión no puede reducir litros')
    if old[5] and (r.ended_at != old[5] or (r.meter_method == 'time_estimate' and float(prior_liters or 0) != r.liters)):
        raise HTTPException(409, 'Carga cerrada: solo se admiten fotos o metadatos tardíos')
    return False


async def identity(cur, r):
    """Preserve historical facts even when an authorization has since been revoked.
    Unknown/mismatched references are retained in metadata for review, never invented.
    """
    reasons = list(r.review_reasons)
    company_id = driver_id = None
    await cur.execute('SELECT active FROM public.station WHERE id=%s', (r.station_id,))
    station = await cur.fetchone()
    if not station:
        raise HTTPException(422, 'Estación inexistente')
    if not station[0]:
        reasons.append('estacion_actualmente_inactiva')
    if r.company_code:
        await cur.execute('SELECT id,active FROM public.company WHERE code=%s', (r.company_code,))
        c=await cur.fetchone()
        if c:
            company_id=c[0]
            await cur.execute('SELECT active FROM public.station_company_access WHERE station_id=%s AND company_id=%s', (r.station_id,company_id))
            access=await cur.fetchone()
            if not c[1] or not access or not access[0]: reasons.append('empresa_sin_habilitacion_actual')
        else: reasons.append('empresa_no_resuelta')
    if r.access_method=='rfid':
        await cur.execute("""SELECT p.id,p.company_id,p.enabled FROM public.pin_user p
          WHERE COALESCE(NULLIF(p.device_employee_no,''),'DRIVER-'||p.id::text)=%s""",(r.employee_no,))
        rows=await cur.fetchall()
        if len(rows)==1 and rows[0][1]==company_id and company_id is not None and (r.pin_user_id is None or r.pin_user_id==rows[0][0]):
            driver_id=rows[0][0]
            await cur.execute("""SELECT 1 FROM public.access_credential WHERE pin_user_id=%s
             AND trim(value)=%s AND kind IN ('rfid','card') AND active
             AND (station_id IS NULL OR station_id=%s)
             AND (valid_from IS NULL OR valid_from<=%s) AND (valid_until IS NULL OR valid_until>%s) LIMIT 1""",
             (driver_id,r.card_no,r.station_id,r.started_at,r.started_at))
            if not rows[0][2] or not await cur.fetchone():reasons.append('credencial_sin_confirmacion_actual')
        else: reasons.append('camionero_no_resuelto_o_empresa_distinta')
    if r.access_method=='company_pin' and not company_id: reasons.append('pin_sin_empresa_resuelta')
    return driver_id,company_id,sorted(set(reasons))


SELECT = '''SELECT id,station_id,offline_revision,offline_meta,liters,ended_at,ts,photo_paths
 FROM public.water_dispatch WHERE offline_id=%s'''


@router.post('/sync')
async def sync(request: Request, background_tasks: BackgroundTasks):
    form = await request.form(max_files=12, max_fields=10, max_part_size=16*1024*1024)
    try:
        r=Receipt.model_validate_json(str(form.get('record') or ''))
    except ValueError:
        raise HTTPException(422, 'Registro local inválido; revisar formato y reloj de la estación')
    fingerprint=digest(r)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(SELECT,(r.local_id,))
            old=await cur.fetchone()
            if check_revision(old,r,fingerprint):
                return dict(ok=True,id=int(old[0]),local_id=str(r.local_id),revision=r.revision)
            # Validate references before storing image bytes.
            await identity(cur,r)
    prior_photos={p['sha'] for p in (old[3].get('photos',[]) if old else [])}
    urls=[]
    for p in r.photos:
        ext='png' if p.mime=='image/png' else 'jpg'
        object_path=f'photos/offline/{r.local_id}/{p.sha}.{ext}'
        f=form.get('photo_'+p.sha)
        if f is not None and hasattr(f,'read'):
            data=await f.read(15*1024*1024+1)
            if len(data)<1000 or len(data)>15*1024*1024 or hashlib.sha256(data).hexdigest()!=p.sha:
                raise HTTPException(422,'Foto incompleta o hash incorrecto')
            if (p.mime=='image/jpeg' and not data.startswith(b'\xff\xd8\xff')) or (p.mime=='image/png' and not data.startswith(b'\x89PNG\r\n\x1a\n')):
                raise HTTPException(415,'Formato de imagen incorrecto')
            url=await _upload_bytes_to_supabase(data=data,content_type=p.mime,object_path=object_path)
        elif p.sha in prior_photos:
            url=_public_url(object_path)
        else:
            raise HTTPException(422,'Falta una foto pendiente de subir')
        urls.append(url)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # Serialize even the first insert, when no row exists to lock yet.
            await cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(str(r.local_id),))
            await cur.execute(SELECT+' FOR UPDATE',(r.local_id,))
            old=await cur.fetchone()
            if check_revision(old,r,fingerprint):
                return dict(ok=True,id=int(old[0]),local_id=str(r.local_id),revision=r.revision)
            driver,company,reasons=await identity(cur,r)
            meta=r.model_dump(mode='json');meta['digest']=fingerprint;meta['review_reasons']=reasons
            # Do not retain card numbers in the remote audit metadata.
            meta.pop('card_no',None)
            if old and old[3].get('volume_calculation'):
                meta['volume_calculation'] = old[3]['volume_calculation']
            liters = r.liters
            flow = r.flow_l_min
            if r.meter_method == 'timestamps' and old:
                liters = old[4]
                flow = (meta.get('volume_calculation') or {}).get('flow_l_min')
            note='REGISTRO LOCAL · '+('CERRADO' if r.ended_at else 'EN CURSO')+(' · pendiente de conversión en app' if r.meter_method == 'timestamps' else ' · litros estimados por tiempo')
            if reasons:note+=' · REVISAR: '+', '.join(reasons)
            await cur.execute('''INSERT INTO public.water_dispatch
                (offline_id,offline_revision,offline_meta,station_id,ts,ended_at,liters,flow_l_min,
                 company_id,pin_user_id,access_method,photo_path,photo_paths,note)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(offline_id) DO UPDATE SET
                 offline_revision=excluded.offline_revision,offline_meta=excluded.offline_meta,
                 ended_at=excluded.ended_at,liters=excluded.liters,flow_l_min=excluded.flow_l_min,
                 company_id=excluded.company_id,pin_user_id=excluded.pin_user_id,
                 access_method=excluded.access_method,photo_path=excluded.photo_path,
                 photo_paths=excluded.photo_paths,note=excluded.note RETURNING id''',
                (r.local_id,r.revision,Jsonb(meta),r.station_id,r.started_at,r.ended_at,liters,flow,
                 company,driver,r.access_method,urls[0] if urls else None,Jsonb(urls),note))
            dispatch_id=int((await cur.fetchone())[0])
    if urls and (not old or old[7]!=urls):background_tasks.add_task(analyze_dispatch_vehicle,dispatch_id)
    return dict(ok=True,id=dispatch_id,local_id=str(r.local_id),revision=r.revision)
