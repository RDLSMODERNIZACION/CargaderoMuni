"""Keep the person authorizing a load separate from the water recipient."""
from app.services.vehicle_company import company_check, autofill_registered_company

# Legacy assisted records store the staff employer in company_id. It is not a
# recipient until an operator explicitly confirms it in the application.
RECIPIENT_COMPANY_SQL = """(CASE WHEN wd.person_role = 'loading_staff'
    AND NOT (COALESCE(wd.ai_vehicle_analysis, '{}'::jsonb) ? 'company_validation'
             OR COALESCE(wd.ai_vehicle_analysis, '{}'::jsonb) ? 'company_assignment')
    THEN NULL ELSE wd.company_id END)"""


def dispatch_parties(role, company_id, company_name, company_code, person_company_name, analysis):
    analysis = analysis or {}
    if analysis.get("company_validation"):
        analysis, _ = autofill_registered_company(analysis, None, company_id)
    # Never fall back to the company of the RFID/PIN holder for visual alerts.
    checked = company_check(analysis, analysis.get('plate_company'),
                            (analysis.get('company_validation') or {}).get('company_name'))
    unconfirmed_assistance = role == 'loading_staff' and not (analysis.get('company_validation') or analysis.get('company_assignment'))
    return {
        'company_id': None if unconfirmed_assistance else company_id,
        'company_name': None if unconfirmed_assistance else company_name,
        'company_code': None if unconfirmed_assistance else company_code,
        'person_company_name': person_company_name,
        'person_role': role,
        'load_mode': {'loading_staff': 'assisted', 'driver': 'self_service'}.get(role, 'unknown'),
        'ai_vehicle_analysis': checked,
    }
