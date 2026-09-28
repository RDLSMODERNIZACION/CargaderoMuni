import pytest
from app.services.dispatch_roles import dispatch_parties
from app.services.vehicle_company import company_check

PHOTO = {'company_visible': 'Parada', 'company_confidence': .95,
         'matches_expected_company': False, 'company_alert': True,
         'company_expected': 'Municipalidad'}


def test_assistant_employer_is_not_recipient_or_ai_reference():
    result = dispatch_parties('loading_staff', 1, 'Municipalidad', 'MUNI', 'Municipalidad', PHOTO)
    assert result['company_id'] is None
    assert result['company_name'] is None
    assert result['person_company_name'] == 'Municipalidad'
    assert result['load_mode'] == 'assisted'
    assert result['ai_vehicle_analysis']['company_alert'] is False
    assert result['ai_vehicle_analysis']['company_suggested'] == 'Parada'
    assert result['ai_vehicle_analysis']['company_expected'] is None


def test_assisted_parada_load_by_municipal_staff_matches_parada():
    photo = {**PHOTO, 'company_validation': {'company_id': 2, 'company_name': 'Parada'},
             'plate_company': {'company_id': 2, 'company_name': 'Parada', 'plate': 'AH303IF'}}
    result = dispatch_parties('loading_staff', 2, 'Parada', 'PAR', 'Municipalidad', photo)
    assert result['company_id'] == 2
    assert result['person_company_name'] == 'Municipalidad'
    assert result['ai_vehicle_analysis']['company_check_status'] == 'match'
    photo['company_visible'] = 'PECOM'
    assert dispatch_parties('loading_staff', 2, 'Parada', 'PAR', 'Municipalidad', photo)['ai_vehicle_analysis']['company_alert'] is True


def test_association_does_not_assign_recipient_until_confirmation():
    photo = {**PHOTO, 'plate_company': {'company_id': 2, 'company_name': 'Parada', 'plate': 'AH303IF'}}
    result = dispatch_parties('loading_staff', 1, 'Municipalidad', 'MUNI', 'Municipalidad', photo)
    assert result['company_id'] is None
    assert result['ai_vehicle_analysis']['company_check_status'] == 'match'


@pytest.mark.parametrize('role,mode', [('driver','self_service'), (None,'unknown')])
def test_classification_preserves_unknown_history(role,mode):
    result=dispatch_parties(role, 2, 'Parada', 'PAR', 'Parada', {})
    assert result['load_mode']==mode
    assert result['company_id']==2
    assert result['ai_vehicle_analysis']['company_expected'] is None
