import os
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
import asyncio
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.auth import CurrentUser, get_current_user
from app.routes import vehicle_ai as route
from app.services import vehicle_ai as service
from app.services.vehicle_company import company_check

ASSOCIATION = {'company_id': 2, 'company_name': 'Parada', 'plate': 'AH303IF'}

@pytest.mark.parametrize('visible,confidence,status', [
    ('PARADA', .9, 'match'), ('Parada S.A.', .9, 'match'),
    ('PECOM', .9, 'mismatch'), (None, 0, 'no_evidence'),
    ('PECOM', .3, 'no_evidence'), ('Parada Transportes', .9, 'mismatch'),
])
def test_visual_evidence_is_independent(visible, confidence, status):
    result = company_check({'company_visible': visible, 'company_confidence': confidence,
                            'plate_validation': {'validator': 'reviewer'}}, ASSOCIATION)
    assert result['company_check_status'] == status
    assert result['company_alert'] == (status == 'mismatch')
    assert result['plate_company'] == ASSOCIATION


def test_no_logo_does_not_invent_a_suggested_company():
    result = company_check({}, ASSOCIATION, 'Parada')
    assert result['company_suggested'] is None
    assert result['matches_expected_company'] is None


def test_suggestion_without_association():
    result = company_check({'company_visible': 'PECOM', 'company_confidence': .9})
    assert result['company_check_status'] == 'unassociated'
    assert result['company_suggested'] == 'PECOM'


class ReviewDB:
    def __init__(self):
        self.sql = ''; self.saved = None; self.mapping_written = False
        self.existing = None; self.allowed = True; self.debited = None
        self.analysis = {'plate': 'AH303IF', 'company_visible': 'PECOM', 'company_confidence': .9}
    def connection(self): return self
    def cursor(self): return self
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def execute(self, sql, params):
        self.sql = ' '.join(sql.split())
        if self.sql.startswith('INSERT INTO public.vehicle_company'): self.mapping_written = True
        if self.sql.startswith('UPDATE public.water_dispatch SET ai_vehicle_analysis'): self.saved = params[0].obj
    async def fetchone(self):
        if self.sql.startswith('SELECT station_id'): return ('2',)
        if self.sql.startswith('SELECT ai_vehicle_analysis'): return (self.analysis,)
        if self.sql.startswith('SELECT s.organization_id'): return (1, None, self.debited)
        if self.sql.startswith('SELECT company_id FROM public.vehicle_company'): return (self.existing,) if self.existing else None
        if 'FROM public.vehicle_company pc' in self.sql: return (2, 'Parada', 'AH303IF') if self.mapping_written else None
        if 'JOIN public.station_company_access' in self.sql: return ('Parada',) if self.allowed else None
        if self.sql.startswith('SELECT c.name'): return ('Parada', 2, None)
        raise AssertionError(self.sql)
    async def fetchall(self): return [(2, 'Parada')]

@pytest.fixture
def setup(monkeypatch):
    db = ReviewDB(); monkeypatch.setattr(route, 'pool', db)
    async def allowed(*args): pass
    monkeypatch.setattr(route, 'require_station_access', allowed)
    app = FastAPI(); app.include_router(route.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser('reviewer', 'reviewer@example.com', 'operator', True)
    return TestClient(app), db


def test_associate_and_preserve_mismatch_after_manual_validation(setup):
    client, db = setup
    response = client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'AH303IF', 'company_id': 2})
    assert response.status_code == 200, response.text
    assert db.mapping_written
    assert db.saved['company_alert'] is True
    assert db.saved['company_suggested'] == 'PECOM'
    assert db.saved['company_validation']['company_name'] == 'Parada'
    assert db.saved['company_reviews'][0]['validated_by'] == 'reviewer'


def test_company_not_allowed_is_rejected(setup):
    client, db = setup; db.allowed = False
    response = client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'AH303IF', 'company_id': 2})
    assert response.status_code == 403
    assert not db.mapping_written and db.saved is None


def test_concurrent_or_unacknowledged_reassignment_is_rejected(setup):
    client, db = setup; db.existing = 3
    response = client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'AH303IF', 'company_id': 2})
    assert response.status_code == 409
    assert not db.mapping_written
    response = client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'AH303IF', 'company_id': 2, 'previous_company_id': 3})
    assert response.status_code == 200
    assert db.saved['company_reviews'][0]['previous_association_company_id'] == 3


def test_cannot_reassign_debited_dispatch(setup):
    client, db = setup; db.debited = '2026-09-28'
    assert client.patch('/ai/vehicle/dispatch/1/plate', json={'plate': 'AH303IF', 'company_id': 2}).status_code == 409
    assert not db.mapping_written


def test_context_and_analysis_require_station_access(setup, monkeypatch):
    client, db = setup
    async def denied(*args): raise HTTPException(403, 'denied')
    monkeypatch.setattr(route, 'require_station_access', denied)
    assert client.get('/ai/vehicle/dispatch/1/company-context?plate=AH303IF').status_code == 403
    assert client.post('/ai/vehicle/dispatch/1').status_code == 403


@pytest.mark.parametrize('failed', [False, True])
def test_reanalysis_preserves_human_review_and_returns_saved_result(monkeypatch, failed):
    class AnalysisDB(ReviewDB):
        async def fetchone(self):
            if 'SELECT wd.photo_paths' in self.sql: return (['https://example.com/photo.jpg'], None, 'Parada')
            if 'SELECT wd.ai_vehicle_analysis' in self.sql:
                return ({'plate': 'AH303IF', 'plate_validation': {'validator': 'human'},
                         'plate_reviews': [{'plate': 'AH303IF'}],
                         'company_validation': {'company_id': 2},
                         'company_reviews': [{'company_id': 2}],
                         'status': 'ok', 'company_visible': 'PECOM', 'company_confidence': .9}, '2', 'Parada', 2, None)
            if 'FROM public.vehicle_company pc' in self.sql: return (2, 'Parada', 'AH303IF')
            return await super().fetchone()
    db = AnalysisDB(); monkeypatch.setattr(service, 'pool', db)
    async def analyze(*args, **kwargs):
        return {'status': 'error', 'error': 'timeout'} if failed else {'status': 'ok', 'plate': 'WR123NG', 'company_visible': 'PECOM', 'company_confidence': .9}
    monkeypatch.setattr(service, 'analyze_vehicle_images', analyze)
    result = asyncio.run(service.analyze_dispatch_vehicle(1))
    assert result == db.saved
    assert result['plate'] == 'AH303IF'
    assert result['company_validation']['company_id'] == 2
    assert result['plate_reviews'] == [{'plate': 'AH303IF'}]
    assert result['company_alert'] is True
    if failed: assert result['last_analysis_error'] == 'timeout'
