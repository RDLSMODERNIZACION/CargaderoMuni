import os
os.environ.setdefault('DATABASE_URL','postgresql://test:test@localhost/test')
from datetime import datetime,timezone,timedelta
from uuid import uuid4
import json,hashlib
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from app.routes import offline_dispatch as off


def body():
    return dict(local_id=str(uuid4()),station_id='2',revision=1,started_at='2026-09-24T12:00:00Z',ended_at='2026-09-24T12:01:00Z',access_method='manual',liters=600,flow_l_min=600,meter_method='time_estimate',photos=[])


def old_row(r,revision=None):
    return (5,r.station_id,revision or r.revision,dict(digest=off.digest(r),photos=[]),r.liters,r.ended_at,r.started_at,[])


def test_revision_guards_duplicate_stale_and_conflicting_receipts():
    r=off.Receipt(**body());old=old_row(r)
    assert off.check_revision(old,r,off.digest(r))
    assert off.check_revision(old_row(r,3),r,off.digest(r))
    with pytest.raises(HTTPException):off.check_revision(old,r,'different')
    higher=r.model_copy(update={'revision':2,'liters':100})
    with pytest.raises(HTTPException):off.check_revision(old,higher,off.digest(higher))
    reopened=r.model_copy(update={'revision':2,'ended_at':None})
    with pytest.raises(HTTPException):off.check_revision(old,reopened,off.digest(reopened))
    photo=r.model_copy(update={'revision':2,'review_reasons':['foto_no_disponible']})
    assert off.check_revision(old,photo,off.digest(photo)) is False


@pytest.mark.parametrize('patch',[{'liters':-1},{'liters':float('nan')},{'started_at':'2026-09-24T12:00:00'},{'ended_at':'2026-09-24T11:00:00Z'},{'started_at':(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()}])
def test_rejects_bad_measurement_or_time(patch):
    with pytest.raises(ValueError):off.Receipt(**(body()|patch))


class Cursor:
    def __init__(self,old=None):self.old=old;self.sql='';self.params=None;self.inserts=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def execute(self,sql,params=None):
        self.sql,self.params=sql,params
        if 'INSERT INTO public.water_dispatch' in sql:self.inserts.append(params)
    async def fetchone(self):
        if 'WHERE offline_id=' in self.sql:return self.old
        if 'SELECT active FROM public.station' in self.sql:return (True,)
        if 'INSERT INTO' in self.sql:return (77,)
        return None
    async def fetchall(self):return []
class Pool:
    def __init__(self,c):self.c=c
    def connection(self):return self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def cursor(self):return self.c

def client(monkeypatch,cursor):
    monkeypatch.setattr(off,'pool',Pool(cursor));app=FastAPI();app.include_router(off.router);return TestClient(app)


def test_receipt_preserves_original_time_and_duplicate_never_inserts(monkeypatch):
    b=body();c=Cursor();cli=client(monkeypatch,c)
    r=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert r.status_code==200,r.text
    assert r.json()['local_id']==b['local_id'];assert len(c.inserts)==1
    assert c.inserts[0][4]==datetime(2026,9,24,12,tzinfo=timezone.utc)
    assert c.inserts[0][6]==600
    c.old=old_row(off.Receipt(**b));c.inserts=[]
    r=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert r.status_code==200;assert not c.inserts


def test_unknown_historical_driver_is_preserved_for_review(monkeypatch):
    b=body()|dict(access_method='rfid',employee_no='DRIVER-2',card_no='0310250706',company_code='3',pin_user_id=2)
    c=Cursor();r=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert r.status_code==200,r.text
    meta=c.inserts[0][2].obj
    assert 'rfid_unknown' in meta['review_reasons']
    assert meta['card_no']=='0310250706'
    assert c.inserts[0][8] is None and c.inserts[0][9] is None


def test_photo_hash_mismatch_never_inserts(monkeypatch):
    b=body()|dict(photos=[dict(sha='a'*64,mime='image/jpeg')]);c=Cursor()
    r=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b)),'photo_'+'a'*64:('x.jpg',b'\xff\xd8\xff'+b'x'*1200,'image/jpeg')})
    assert r.status_code==422;assert not c.inserts


def test_storage_failure_never_acknowledges_or_inserts(monkeypatch):
    image=b'\xff\xd8\xff'+b'x'*1200;sha=hashlib.sha256(image).hexdigest();b=body()|dict(photos=[dict(sha=sha,mime='image/jpeg')]);c=Cursor()
    async def fail(**kw):raise HTTPException(502,'Storage offline')
    monkeypatch.setattr(off,'_upload_bytes_to_supabase',fail)
    r=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b)),'photo_'+sha:('x.jpg',image,'image/jpeg')})
    assert r.status_code==502;assert not c.inserts

def timestamps():
    b=body();b.pop('liters');b.pop('flow_l_min')
    return b|dict(meter_method='timestamps',pump_started_at='2026-09-24T12:00:10Z')

def test_timestamps_without_volume_and_late_photo_preserves_conversion(monkeypatch):
    b=timestamps();c=Cursor();cli=client(monkeypatch,c)
    res=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    assert c.inserts[0][6:8] == (None,None)
    receipt=off.Receipt(**b);meta=receipt.model_dump(mode='json')
    meta.update(digest=off.digest(receipt),volume_calculation={'flow_l_min':120,'liters':100})
    c.old=(77,'2',1,meta,100,receipt.ended_at,receipt.started_at,[])
    b['revision']=2
    res=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    assert c.inserts[-1][6:8] == (100,120)
    assert c.inserts[-1][2].obj['volume_calculation']['liters']==100

def test_pump_time_is_immutable_after_recorded():
    r=off.Receipt(**timestamps());meta=r.model_dump(mode='json');meta['digest']=off.digest(r)
    old=(77,'2',1,meta,None,r.ended_at,r.started_at,[])
    altered=r.model_copy(update={'revision':2,'pump_started_at':r.started_at})
    with pytest.raises(HTTPException):off.check_revision(old,altered,off.digest(altered))

@pytest.mark.parametrize('patch',[{'liters':0},{'pump_started_at':'2026-09-24T11:59:59Z'},{'pump_started_at':'2026-09-24T12:01:01Z'}])
def test_invalid_timestamps(patch):
    with pytest.raises(ValueError):off.Receipt(**(timestamps()|patch))


def test_station_flow_automatically_converts_closed_load_and_locks_history(monkeypatch):
    b=timestamps();c=Cursor();original_fetch=c.fetchone;c.rate=120
    async def fetch():
        if 'SELECT flow_l_min' in c.sql:return (c.rate,)
        return await original_fetch()
    c.fetchone=fetch
    cli=client(monkeypatch,c)
    res=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    inserted=c.inserts[-1];assert inserted[6:8]==(100,120) # 50 seconds
    assert inserted[2].obj['volume_calculation']['source']=='station'
    receipt=off.Receipt(**b)
    c.old=(77,'2',1,inserted[2].obj,100,receipt.ended_at,receipt.started_at,[])
    c.rate=600;b['revision']=2
    res=cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    assert c.inserts[-1][6:8]==(100,120)

def test_station_flow_does_not_convert_interrupted_or_open_load(monkeypatch):
    for patch in [{'ended_at':None},{'review_reasons':['intervalo_sin_medicion']}]:
        b=timestamps()|patch;c=Cursor();original=c.fetchone
        async def fetch():
            if 'SELECT flow_l_min' in c.sql:return (600,)
            return await original()
        c.fetchone=fetch
        res=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b))})
        assert res.status_code==200,res.text
        assert c.inserts[-1][6] is None


def test_recorder_creation_delay_preserves_original_times_and_syncs(monkeypatch):
    b=timestamps()|dict(started_at='2026-09-25T00:38:26.703Z',pump_started_at='2026-09-25T00:38:26.701Z',ended_at='2026-09-25T00:38:51.155Z')
    r=off.Receipt(**b)
    assert (r.started_at-r.pump_started_at).total_seconds()==0.002
    c=Cursor();res=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    assert c.inserts[-1][4]==r.started_at
    assert c.inserts[-1][2].obj['pump_started_at']==r.pump_started_at.isoformat().replace('+00:00','Z')

@pytest.mark.parametrize('milliseconds',[101,1000,60000])
def test_creation_tolerance_does_not_hide_invalid_clock(milliseconds):
    b=timestamps();start=datetime.fromisoformat(b['started_at'].replace('Z','+00:00'))
    b['pump_started_at']=(start-timedelta(milliseconds=milliseconds)).isoformat()
    with pytest.raises(ValueError):off.Receipt(**b)

class CardCursor(Cursor):
    def __init__(self, rows):
        super().__init__();self.rows=rows;self.card_params=[]
    async def execute(self,sql,params=None):
        await super().execute(sql,params)
        if 'FROM public.access_credential a' in sql:self.card_params.append(params)
    async def fetchall(self):
        return self.rows if 'FROM public.access_credential a' in self.sql else []


def test_card_only_resolves_driver_ignores_device_and_local_company(monkeypatch):
    c=CardCursor([(2,3,'Victor','KOMPASS','DRIVER-2','3',True)])
    b=timestamps()|dict(access_method='rfid',card_no='0310250706',employee_no='5',
        company_code='WRONG',pin_user_id=999,
        review_reasons=['padron_ausente_o_vencido','identidad_no_habilitada_en_padron','foto_no_disponible'])
    res=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    row=c.inserts[-1];meta=row[2].obj
    assert row[8:11]==(3,2,'rfid')
    assert meta['card_no']=='0310250706'
    assert meta['identity_resolution']['driver_name']=='Victor'
    assert meta['review_reasons']==['foto_no_disponible']
    assert c.card_params[-1][2:] == ('2','0310250706','2')
    assert c.card_params[-1][0]==off.Receipt(**b).started_at


@pytest.mark.parametrize('rows,status',[
    ([], 'unknown'),
    ([(2,3,'V','K','DRIVER-2','3',False)],'not_authorized'),
    ([(2,3,'V','K','DRIVER-2','3',True),(4,4,'Other','X','DRIVER-4','4',True)],'ambiguous'),
])
def test_unresolved_card_stays_rfid_without_company_assignment(monkeypatch,rows,status):
    c=CardCursor(rows);b=timestamps()|dict(access_method='rfid',card_no='0311022018',company_code='3')
    res=client(monkeypatch,c).post('/water/offline/sync',files={'record':(None,json.dumps(b))})
    assert res.status_code==200,res.text
    row=c.inserts[-1]
    assert row[8:11]==(None,None,'rfid')
    assert row[2].obj['identity_resolution']['status']==status


def test_late_revision_preserves_association_after_card_reassigned(monkeypatch):
    c=CardCursor([(2,3,'Victor','KOMPASS','DRIVER-2','3',True)])
    b=timestamps()|dict(access_method='rfid',card_no='0310250706')
    cli=client(monkeypatch,c)
    assert cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))}).status_code==200
    meta=c.inserts[-1][2].obj;r=off.Receipt(**b)
    c.old=(77,'2',1,meta,None,r.ended_at,r.started_at,[])
    c.rows=[(9,10,'Nuevo','Otra','DRIVER-9','10',True)]
    b['revision']=2
    assert cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))}).status_code==200
    assert c.inserts[-1][8:11]==(3,2,'rfid')
    assert c.inserts[-1][2].obj['identity_resolution']==meta['identity_resolution']
    b['card_no']='other'
    assert cli.post('/water/offline/sync',files={'record':(None,json.dumps(b))}).status_code==409


def test_safe_identity_projection_excludes_card():
    from app.routes.water import dispatch_identity
    assert dispatch_identity({'card_no':'0311022018','identity_resolution':{
        'status':'resolved','driver_name':'Victor','card_no':'secret','pin_user_id':2}})=={
        'status':'resolved','driver_name':'Victor'}
