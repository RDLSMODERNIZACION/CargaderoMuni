import os
from datetime import datetime, timezone
os.environ.setdefault('DATABASE_URL','postgresql://test:test@localhost/test')
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routes import water

class Cursor:
    def __init__(self): self.calls=[]; self.sql=''
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    async def execute(self,sql,params=None): self.sql=sql; self.calls.append((sql,params))
    async def fetchall(self): return [(2,3,'3')]
    async def fetchone(self):
        if 'INSERT INTO' in self.sql:return (99,datetime.now(timezone.utc))
        return (3,)
class Pool:
    def __init__(self,cursor): self.cur=cursor
    def connection(self): return self
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    def cursor(self): return self.cur

def client(monkeypatch):
    cur=Cursor();monkeypatch.setattr(water,'pool',Pool(cur));monkeypatch.setenv('HIK_SYNC_TOKEN','test-token')
    app=FastAPI();app.include_router(water.router,prefix='/water')
    return TestClient(app),cur

def test_json_and_multipart_store_driver_and_method(monkeypatch):
    c,cur=client(monkeypatch)
    data=dict(station_id='3',company_code='3',employee_no='DRIVER-2',card_no='00123',access_method='rfid')
    for kwargs in [dict(json=data),dict(files={k:(None,v) for k,v in data.items()})]:
        r=c.post('/water/dispatch/start',headers={'X-Hik-Sync-Token':'test-token'},**kwargs)
        assert r.status_code==200, r.text
        assert r.json()['pin_user_id']==2 and r.json()['access_method']=='rfid'
        inserts=[p for sql,p in cur.calls if 'INSERT INTO public.water_dispatch' in sql]
        assert inserts[-1][1]==3 and inserts[-1][-2:]==(2,'rfid')

def test_rfid_without_token_has_no_insert(monkeypatch):
    c,cur=client(monkeypatch)
    r=c.post('/water/dispatch/start',json=dict(station_id='3',employee_no='DRIVER-2',card_no='123'))
    assert r.status_code==401
    assert not any('INSERT' in sql for sql,p in cur.calls)

def test_legacy_pin_and_manual_still_work(monkeypatch):
    c,cur=client(monkeypatch)
    for data,method in [(dict(station_id='3',company_code='3'),'company_pin'),(dict(station_id='3'),'manual')]:
        r=c.post('/water/dispatch/start',json=data)
        assert r.status_code==200
        assert r.json()['access_method']==method and r.json()['pin_user_id'] is None
