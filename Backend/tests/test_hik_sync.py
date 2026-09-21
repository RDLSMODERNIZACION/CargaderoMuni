import asyncio
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import HTTPException
from app.services.hik_sync import build_inventory, require_sync_token, resolve_driver

NOW = datetime(2026, 9, 21, tzinfo=timezone.utc)
COMPANIES = [('3', 'KOMPASS', '1234', True)]
DRIVERS = [(2, 'VICTOR', True, 'DRIVER-2', '3', True)]

def test_inventory_global_and_station_cards_keep_leading_zero():
    out=build_inventory(COMPANIES,DRIVERS,[(2,'00123',True,None,None,None),(2,'999',True,'2',None,None)],'3',NOW)
    assert out['items'][1]['cards']==['00123']
    assert out['items'][1]['pin_user_id']==2
    assert out['items'][0]['employeeNo']=='3'
    assert out['items'][1]['password'] is None

@pytest.mark.parametrize('active,begin,end',[(False,None,None),(True,NOW+timedelta(days=1),None),(True,None,NOW)])
def test_disabled_future_expired_credentials(active,begin,end):
    u=build_inventory([],DRIVERS,[(2,'00123',active,None,begin,end)],'3',NOW)['items'][0]
    assert not u['active'] and not u['cards']

def test_company_disabled_blocks_driver():
    u=build_inventory([],[(2,'V',True,'DRIVER-2','3',False)],[(2,'123',True,None,None,None)],'3',NOW)['items'][0]
    assert u['active'] is False

def test_duplicate_rfid_aliases_across_people_abort():
    with pytest.raises(HTTPException) as e:
        build_inventory([],DRIVERS+[(3,'OTHER',True,'DRIVER-3','3',True)],[(2,'123',True,None,None,None),(3,'123',True,None,None,None)],'3',NOW)
    assert e.value.status_code==409

def test_token_required(monkeypatch):
    monkeypatch.delenv('HIK_SYNC_TOKEN',raising=False)
    with pytest.raises(HTTPException) as e: require_sync_token('x')
    assert e.value.status_code==503
    monkeypatch.setenv('HIK_SYNC_TOKEN','test-secret')
    with pytest.raises(HTTPException) as e: require_sync_token('wrong')
    assert e.value.status_code==401
    require_sync_token('test-secret')

class Cursor:
    def __init__(self, rows): self.rows=rows
    async def execute(self, sql, params): self.sql,self.params=sql,params
    async def fetchall(self): return self.rows

def test_driver_resolved_from_db_and_company_cannot_be_forged():
    cur=Cursor([(2,3,'3')])
    assert asyncio.run(resolve_driver(cur,'3','DRIVER-2','00123','3'))==(2,3,'3')
    assert cur.params==('3','DRIVER-2','00123')
    with pytest.raises(HTTPException) as e: asyncio.run(resolve_driver(cur,'3','DRIVER-2','00123','1'))
    assert e.value.status_code==409
    with pytest.raises(HTTPException) as e: asyncio.run(resolve_driver(Cursor([]),'3','DRIVER-2','00123'))
    assert e.value.status_code==403
