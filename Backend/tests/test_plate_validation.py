import os
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.auth import CurrentUser, get_current_user
from app.routes import vehicle_ai

class DB:
    def __init__(self):
        self.sql = ''; self.saved = None
        self.analysis = {'plate': 'AB123CE', 'company_visible': 'Empresa'}
    def connection(self): return self
    def cursor(self): return self
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def execute(self, sql, params):
        self.sql = sql
        if sql.startswith('UPDATE'): self.saved = params[0].obj
    async def fetchone(self):
        return ('2',) if 'SELECT station_id' in self.sql else (self.analysis,)

@pytest.fixture
def setup(monkeypatch):
    db = DB(); monkeypatch.setattr(vehicle_ai, 'pool', db)
    async def allowed(user, station, roles):
        assert station == '2'
        assert roles == {'owner', 'admin', 'operator'}
    monkeypatch.setattr(vehicle_ai, 'require_station_access', allowed)
    app = FastAPI(); app.include_router(vehicle_ai.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser('reviewer', 'reviewer@example.com', 'operator', True)
    return TestClient(app), db

def test_review_preserves_evidence_and_audit(setup):
    client, db = setup
    response = client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'ab 123-cd'})
    assert response.status_code == 200
    assert db.saved['plate'] == 'AB123CD'
    assert db.saved['plate_first_pass'] == 'AB123CE'
    assert db.saved['company_visible'] == 'Empresa'
    assert db.saved['plate_validation']['validated_by'] == 'reviewer'
    assert db.saved['plate_validation']['validated_at']
    assert db.saved['plate_review_required'] is False
    db.analysis = db.saved
    client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'ABC123'})
    assert len(db.saved['plate_reviews']) == 2

@pytest.mark.parametrize('plate', ['', '123456', 'AB123C?', 'AB123CDE', 'ＡＢ123CD'])
def test_invalid_format_rejected(setup, plate):
    client, db = setup
    assert client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': plate}).status_code == 422
    assert db.saved is None

def test_station_permission_denies_write(setup, monkeypatch):
    client, db = setup
    async def denied(*args): raise HTTPException(403, 'Not allowed')
    monkeypatch.setattr(vehicle_ai, 'require_station_access', denied)
    assert client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'ABC123'}).status_code == 403
    assert db.saved is None

def test_missing_dispatch(setup, monkeypatch):
    client, db = setup
    async def missing(): return None
    db.fetchone = missing
    assert client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'ABC123'}).status_code == 404
