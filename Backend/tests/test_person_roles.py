import asyncio
import os
import pytest
from pydantic import ValidationError
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
from app.routes import company


def test_person_role_validation_and_legacy_defaults():
    assert company.DriverIn(name='Test').person_role == 'driver'
    assert company.DriverIn(name='Test', person_role='loading_staff').person_role == 'loading_staff'
    for role in ['admin', '', None]:
        with pytest.raises(ValidationError):
            company.DriverPatch(person_role=role)


def test_unrelated_patch_does_not_reset_person_role():
    assert 'person_role' not in company.DriverPatch(enabled=False).model_dump(exclude_unset=True)


def test_role_only_edit_keeps_device_identity_and_credentials(monkeypatch):
    class DB:
        def __init__(self): self.calls = []
        def connection(self): return self
        def cursor(self): return self
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def execute(self, sql, params): self.calls.append((sql, params))
        async def fetchone(self): return (3, 'Test')
    db = DB()
    monkeypatch.setattr(company, 'pool', db)
    asyncio.run(company.update_company_driver(1, 3, company.DriverPatch(person_role='loading_staff'), None))
    mutations = [(sql, params) for sql, params in db.calls if sql.startswith('UPDATE')]
    assert len(mutations) == 1
    sql, params = mutations[0]
    assert 'person_role = %s' in sql
    assert params == ('loading_staff', 3, 1)
    assert 'device_employee_no' not in sql and 'access_credential' not in sql
