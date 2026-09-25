import os
os.environ.setdefault('DATABASE_URL','postgresql://test:test@localhost/test')
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from app.routes import water
from app.auth import CurrentUser, get_current_user

class DB:
    def __init__(self):
        self.sql='';self.saved=None;self.debited=None
        self.meta={'meter_method':'timestamps','pump_started_at':'2026-09-24T12:00:10Z','review_reasons':[]}
        self.end=datetime(2026,9,24,12,1,10,tzinfo=timezone.utc)
    def connection(self):return self
    def cursor(self):return self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def execute(self,sql,params):
        self.sql=sql
        if sql.startswith('UPDATE'):self.saved=params
    async def fetchone(self):return ('2',) if 'SELECT station_id' in self.sql else (self.end,self.meta,self.debited)

@pytest.fixture
def setup(monkeypatch):
    db=DB();monkeypatch.setattr(water,'pool',db)
    async def access(user,station,roles):assert station=='2' and 'operator' in roles
    monkeypatch.setattr(water,'require_station_access',access)
    app=FastAPI();app.include_router(water.router,prefix='/water')
    app.dependency_overrides[get_current_user]=lambda:CurrentUser('operator','operator@example.com','operator',True)
    return TestClient(app),db

def test_calculation_and_recalculation_keep_timestamps(setup):
    c,db=setup
    for flow in [600,120]:
        r=c.post('/water/dispatch/1/convert-time',json={'flow_l_min':flow})
        assert r.status_code==200,r.text
        assert r.json()['liters']==flow
        assert db.saved[2].obj['pump_started_at']=='2026-09-24T12:00:10Z'
        assert db.saved[2].obj['volume_calculation']['calculated_by']=='operator'

@pytest.mark.parametrize('problem',['no_end','no_start','interruption','debited','wrong_method'])
def test_incomplete_or_unreliable_times_not_converted(setup,problem):
    c,db=setup
    if problem=='no_end':db.end=None
    if problem=='no_start':db.meta.pop('pump_started_at')
    if problem=='interruption':db.meta['review_reasons']=['intervalo_sin_medicion']
    if problem=='debited':db.debited=db.end
    if problem=='wrong_method':db.meta['meter_method']='time_estimate'
    assert c.post('/water/dispatch/1/convert-time',json={'flow_l_min':600}).status_code==409
    assert db.saved is None

def test_station_permission_enforced(setup,monkeypatch):
    c,db=setup
    async def denied(*args):raise HTTPException(403,'Denied')
    monkeypatch.setattr(water,'require_station_access',denied)
    assert c.post('/water/dispatch/1/convert-time',json={'flow_l_min':600}).status_code==403
    assert db.saved is None

@pytest.mark.parametrize('flow',[0,-1,1000001])
def test_invalid_flow(setup,flow):
    c,db=setup
    assert c.post('/water/dispatch/1/convert-time',json={'flow_l_min':flow}).status_code==422
