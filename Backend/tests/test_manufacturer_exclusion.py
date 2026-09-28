import pytest
from app.services.vehicle_company import company_check
from app.services.dispatch_roles import dispatch_parties

ASSOCIATION={'company_id':2,'company_name':'Parada','plate':'AH303IF'}

@pytest.mark.parametrize('brand',['IVECO','Scania','Mercedes-Benz','Mercedes Benz 1720','Volvo','Volkswagen','VW','Ford','Iveco Tector 170E','Scania P310','Renault Trucks','MAN','Foton','Mitsubishi Fuso','Randon','Econovo'])
def test_brands_and_models_are_not_company_suggestions(brand):
    result=company_check({'company_visible':brand,'company_confidence':.99},ASSOCIATION)
    assert result['company_suggested'] is None
    assert result['company_visible'] is None
    assert result['company_visible_raw']==brand
    assert result['company_alert'] is False
    assert result['matches_expected_company'] is None
    assert result['plate_company']==ASSOCIATION
    assert company_check(result,ASSOCIATION)==result


def test_new_or_unknown_manufacturer_identified_by_ai_is_excluded():
    result=company_check({'company_visible':'Example Motors','company_confidence':.99,'vehicle_manufacturer':'Example Motors'},ASSOCIATION)
    assert result['company_suggested'] is None


@pytest.mark.parametrize('name',['Parada','PECOM','Transportes del Sur','Servicios Integrales','Transman'])
def test_transport_businesses_remain_available(name):
    result=company_check({'company_visible':name,'company_confidence':.95,'vehicle_manufacturer':'IVECO'},ASSOCIATION)
    assert result['company_suggested']==name
    assert result['company_alert']==(name!='Parada')


def test_historical_false_alert_is_filtered_on_read():
    old={'company_visible':'IVECO','company_confidence':.99,'company_alert':True,'company_suggested':'IVECO','plate_company':ASSOCIATION}
    result=dispatch_parties('loading_staff',2,'Parada','PAR','Municipalidad',old)
    assert result['ai_vehicle_analysis']['company_visible'] is None
    assert result['ai_vehicle_analysis']['company_alert'] is False


@pytest.mark.parametrize('label', ['Servicios Públicos', 'SERVICIOS PUBLICOS', ' servicios   públicos ', 'Ecotrosa', 'ECOTROSA', 'Econovo'])
def test_user_excluded_labels_never_suggest_or_alert(label):
    result = company_check({'company_visible': label, 'company_confidence': .99}, ASSOCIATION)
    assert result['company_suggested'] is None
    assert result['company_alert'] is False
    assert result['company_visible_raw'] == label.strip()
    assert result['plate_company'] == ASSOCIATION


def test_rincon_municipal_reference_is_also_excluded():
    name = 'Municipalidad de Rincón de los Sauces / Obras y Servicios Públicos'
    result = company_check({'company_visible': name, 'company_confidence': .9})
    assert result['company_suggested'] is None


@pytest.mark.parametrize('label', [
    'Rincón del Sauce', 'Rincon de los Sauces', 'RINCÓN DE LOS SAUCES',
    'Municipalidad de Rincón de los Sauces',
    'Municipalidad de Rincon de los Sauces / Obras y Servicios Publicos',
    'Rincón de los Sauce', 'Rincon del Sauces', 'Rincon los Sauces',
    'RDLS', 'M.R.D.L.S.', 'R.D.L.S.', 'Municipalidad RDLS',
])
def test_geographic_and_municipal_references_are_not_companies(label):
    result=company_check({'company_visible':label,'company_confidence':.99},ASSOCIATION)
    assert result['company_suggested'] is None
    assert result['company_alert'] is False
    assert result['company_visible_raw']==label
    assert result['plate_company']==ASSOCIATION


def test_unrelated_company_and_manually_confirmed_municipality_are_preserved():
    municipal={'company_id':5,'company_name':'Municipalidad de Rincón de los Sauces','plate':'AH303IF'}
    result=company_check({'company_visible':'Rincón del Sauce','company_confidence':.99},municipal)
    assert result['plate_company']==municipal
    assert result['company_expected']==municipal['company_name']
    result=company_check({'company_visible':'Parada','company_confidence':.99},ASSOCIATION)
    assert result['company_suggested']=='Parada'
    assert result['company_alert'] is False
