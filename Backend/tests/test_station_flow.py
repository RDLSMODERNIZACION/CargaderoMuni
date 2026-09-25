import os
os.environ.setdefault('DATABASE_URL','postgresql://test:test@localhost/test')
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.routes import stations
from app.auth import CurrentUser,get_current_user

class DB:
    def __init__(self):self.flow=None;self.writes=0
    def cursor(self):return self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def execute(self,sql,params):
        if 'UPDATE' in sql:
            self.writes+=1
            if 'flow_l_min = %s' in sql:self.flow=params[0]
    async def fetchone(self):return ('2','Bombeo Viejo',True,None,None,None,1,self.flow)

@pytest.fixture
def setup(monkeypatch):
    db=DB();monkeypatch.setattr(stations,'get_conn',lambda:db)
    async def access(*args):pass
    monkeypatch.setattr(stations,'require_station_access',access)
    app=FastAPI();app.include_router(stations.router)
    app.dependency_overrides[get_current_user]=lambda:CurrentUser('admin','a@example.com','admin',True)
    return TestClient(app),db

def test_save_read_and_clear_station_rate(setup):
    c,db=setup
    for value in [600,120,None]:
        res=c.patch('/stations/2',json={'flow_l_min':value})
        assert res.status_code==200,res.text
        assert res.json()['flow_l_min']==value
        assert c.get('/stations/2').json()['flow_l_min']==value

@pytest.mark.parametrize('value',[0,-1,1000001])
def test_bad_station_rate(setup,value):
    c,db=setup
    assert c.patch('/stations/2',json={'flow_l_min':value}).status_code==422
    assert db.writes==0

def test_station_permissions_enforced(setup,monkeypatch):
    c,db=setup
    async def deny(user,station,roles):
        assert roles=={'owner','admin'}
        raise HTTPException(403,'Denied')
    monkeypatch.setattr(stations,'require_station_access',deny)
    assert c.patch('/stations/2',json={'flow_l_min':600}).status_code==403
    assert db.writes==0
