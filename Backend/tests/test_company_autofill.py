import os
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
import asyncio
import pytest
from app.services.vehicle_company import autofill_registered_company, company_check
from app.services.dispatch_roles import dispatch_parties
from app.services import vehicle_ai

ASSOCIATION = {'plate': 'AH303IF', 'company_id': 2, 'company_name': 'Parada'}
PHOTO = {'plate': 'AH303IF', 'plate_confidence': .96, 'status': 'ok'}


def test_repeated_visit_autofills_without_fabricating_manual_review():
    result, company_id = autofill_registered_company(PHOTO, ASSOCIATION, 1)
    assert company_id == 2
    assert result['company_assignment']['source'] == 'confirmed_plate'
    assert result['company_assignment']['previous_company_id'] == 1
    assert not result.get('company_validation')
    assert not result.get('plate_validation')
    assert autofill_registered_company(result, ASSOCIATION, 2) == (result, 2)


@pytest.mark.parametrize('confidence', [0, .2, .89])
def test_uncertain_current_reading_requires_review(confidence):
    result, company_id = autofill_registered_company({**PHOTO, 'plate_confidence': confidence}, ASSOCIATION, None)
    assert company_id is None
    assert not result.get('company_assignment')


def test_manual_plate_review_allows_lookup_even_without_ai_confidence():
    result, company_id = autofill_registered_company({'plate': 'AH303IF', 'plate_validation': {'plate': 'AH303IF'}}, ASSOCIATION, None)
    assert company_id == 2
    assert result['company_assignment']['plate'] == 'AH303IF'


def test_needs_exact_authorized_registry_match():
    assert autofill_registered_company(PHOTO, None, 1)[1] == 1
    assert autofill_registered_company({**PHOTO, 'plate': 'AH3031F'}, ASSOCIATION, 1)[1] == 1


def test_preserves_manual_company_and_billing():
    analysis = {**PHOTO, 'company_validation': {'company_id': 3, 'company_name': 'Other'}}
    assert autofill_registered_company(analysis, ASSOCIATION, 3) == (analysis, 3)
    assert autofill_registered_company(PHOTO, ASSOCIATION, 3, '2026-09-28') == (PHOTO, 3)


def test_assisted_recipient_and_person_company_remain_separate():
    analysis, company_id = autofill_registered_company(PHOTO, ASSOCIATION, 1)
    data = dispatch_parties('loading_staff', company_id, 'Parada', 'PAR', 'Municipalidad', analysis)
    assert data['company_id'] == 2
    assert data['person_company_name'] == 'Municipalidad'
    assert data['load_mode'] == 'assisted'


def test_visual_disagreement_does_not_override_registry():
    analysis, company_id = autofill_registered_company({**PHOTO, 'company_visible': 'PECOM', 'company_confidence': .99}, ASSOCIATION, None)
    checked = company_check(analysis, ASSOCIATION)
    assert company_id == 2
    assert checked['company_suggested'] == 'PECOM'
    assert checked['company_alert'] is True


def test_changed_plate_removes_stale_autofill_and_retains_audit():
    analysis, _ = autofill_registered_company(PHOTO, ASSOCIATION, 1)
    result, company_id = autofill_registered_company({**analysis, 'plate': 'AB123CD'}, None, 2)
    assert company_id == 1
    assert 'company_assignment' not in result
    assert result['company_assignment_history'][0]['plate'] == 'AH303IF'


def test_transient_analysis_failure_keeps_assignment():
    analysis, _ = autofill_registered_company(PHOTO, ASSOCIATION, None)
    failed = {**analysis, 'last_analysis_error': 'timeout'}
    assert autofill_registered_company(failed, None, 2) == (failed, 2)


def test_analysis_persists_company_and_metadata_atomically(monkeypatch):
    class DB:
        def connection(self): return self
        def cursor(self): return self
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def execute(self, sql, params):
            self.sql = sql
            if sql.startswith('UPDATE'):
                self.saved = params
                assert 'ai_vehicle_analysis=%s, company_id=%s' in sql
        async def fetchone(self):
            if 'SELECT wd.photo_paths' in self.sql: return (['https://example.com/test.jpg'], None, 'Municipalidad')
            if 'SELECT wd.ai_vehicle_analysis' in self.sql: return ({}, '2', 'Municipalidad', 1, None)
            if 'FROM public.vehicle_company pc' in self.sql: return (2, 'Parada', 'AH303IF')
            raise AssertionError(self.sql)
    db=DB(); monkeypatch.setattr(vehicle_ai, 'pool', db)
    async def analyze(*args, **kwargs): return dict(PHOTO)
    monkeypatch.setattr(vehicle_ai, 'analyze_vehicle_images', analyze)
    result=asyncio.run(vehicle_ai.analyze_dispatch_vehicle(123))
    assert db.saved[1:] == (2, 123)
    assert db.saved[0].obj == result
    assert result['company_assignment']['company_name'] == 'Parada'



def test_manual_correction_supersedes_auto_assignment():
    auto, _ = autofill_registered_company(PHOTO, ASSOCIATION, None)
    manual = {**auto, 'company_validation': {'company_id': 3, 'company_name': 'PECOM'}}
    result, company_id = autofill_registered_company(manual, ASSOCIATION, 3)
    assert company_id == 3
    assert 'company_assignment' not in result
    assert result['company_assignment_history'][0]['company_id'] == 2
    presented = dispatch_parties('loading_staff', 3, 'PECOM', 'PEC', 'Municipalidad', manual)
    assert 'company_assignment' not in presented['ai_vehicle_analysis']
    assert presented['company_id'] == 3
