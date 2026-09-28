"""Verified plate associations and independent visual company evidence."""
from datetime import datetime, timezone
import re
import unicodedata


def company_key(value):
    text = unicodedata.normalize('NFKD', value or '')
    text = ''.join(c for c in text if not unicodedata.combining(c)).upper()
    # Only separate legal suffixes, never fuzzy/substring matching.
    text = re.sub(r'\s+(?:S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?)\s*$', '', text)
    return re.sub(r'[^A-Z0-9]', '', text)


# Exact manufacturer names and badges with model names. Keep the raw extraction
# for audit, but never use it as a recipient-company suggestion.
TRUCK_MANUFACTURERS = (
    "MERCEDES BENZ", "MERCEDES", "VOLKSWAGEN", "VW", "IVECO", "SCANIA",
    "VOLVO", "FORD", "RENAULT", "MAN", "DAF", "FIAT", "CHEVROLET", "DODGE",
    "INTERNATIONAL", "KENWORTH", "PETERBILT", "MACK", "HINO", "ISUZU",
    "MITSUBISHI FUSO", "MITSUBISHI", "FUSO", "FOTON", "SHACMAN", "SINOTRUK",
    "HOWO", "JAC", "JMC", "FAW", "DONGFENG", "DFSK", "HYUNDAI", "KIA",
    "TATA", "ASHOK LEYLAND", "RANDON", "ECONOVO",
)


def manufacturer_only(value, detected_manufacturer=None):
    key = company_key(value)
    if not key:
        return False
    if detected_manufacturer and key == company_key(detected_manufacturer):
        return True
    text = unicodedata.normalize('NFKD', value or '').upper()
    text = re.sub(r'[^A-Z0-9]+', ' ', text).strip()
    for brand in TRUCK_MANUFACTURERS:
        if key == company_key(brand):
            return True
        # A manufacturer followed by a model (e.g. IVECO TECTOR 170E) is
        # vehicle information. Do not suppress explicit transport business names.
        if text.startswith(brand + ' ') and not re.search(
            r'\b(?:TRANSPORTES?|TRANSPORTE|LOGISTICA|SERVICIOS|DISTRIBUCION)\b', text
        ):
            return True
    return False


# User-defined exclusions: these labels are not recipient companies.
EXCLUDED_COMPANY_LABELS = {"SERVICIOSPUBLICOS", "ECOTROSA"}


def excluded_company_label(value):
    if company_key(value) in EXCLUDED_COMPANY_LABELS:
        return True
    text = unicodedata.normalize('NFKD', value or '')
    text = ''.join(c for c in text if not unicodedata.combining(c)).upper()
    text = re.sub(r'[^A-Z0-9]+', ' ', text).strip()
    # Geographic/municipal references are explicitly excluded by the operator.
    return bool(re.search(r'\bRINCON (?:(?:DE LOS|DEL|DE|LOS) )?SAUCES?\b', text)
                or re.search(r'\b(?:M ?)?R ?D ?L ?S\b', text))


def company_check(analysis, association=None, expected_company=None):
    result = dict(analysis)
    visible = (analysis.get('company_visible') or '').strip()
    confidence = float(analysis.get('company_confidence') or 0)
    exclusion = ('non_company_label' if excluded_company_label(visible)
                 else 'vehicle_manufacturer' if manufacturer_only(visible, analysis.get('vehicle_manufacturer')) else None)
    if exclusion:
        result['company_visible_raw'] = visible
        result['company_confidence_raw'] = confidence
        result['company_exclusion_reason'] = exclusion
        result['company_visible'] = None
        result['company_confidence'] = 0
        visible = ''
        confidence = 0
    suggested = visible if visible and confidence >= 0.6 else None
    expected = association['company_name'] if association else expected_company
    status = 'no_evidence'
    if suggested:
        status = ('match' if company_key(suggested) == company_key(expected) else 'mismatch') if expected else 'unassociated'
    result.update(company_suggested=suggested, plate_company=association,
                  company_check_status=status, company_alert=status == 'mismatch',
                  company_expected=expected,
                  matches_expected_company={'match': True, 'mismatch': False}.get(status))
    return result


async def find_association(cur, station_id, plate):
    if not plate:
        return None
    await cur.execute('''
        SELECT pc.company_id, c.name, pc.plate
        FROM public.vehicle_company pc
        JOIN public.station s ON s.organization_id = pc.organization_id
        JOIN public.company c ON c.id = pc.company_id AND c.active
        JOIN public.station_company_access sca ON sca.station_id = s.id
          AND sca.company_id = c.id AND sca.active
        WHERE s.id = %s AND pc.plate = %s
    ''', (station_id, plate))
    row = await cur.fetchone()
    return {'company_id': row[0], 'company_name': row[1], 'plate': row[2]} if row else None


def autofill_registered_company(analysis, association, current_company_id, debited_at=None):
    """Apply only a manually registered, station-authorized exact plate match.

    The current photo still needs a reliable plate reading (or manual review).
    This is an automatic assignment, never a fabricated human validation.
    """
    result = dict(analysis)
    if result.get('company_validation'):
        previous = result.pop('company_assignment', None)
        if previous:
            result['company_assignment_history'] = [*result.get('company_assignment_history', []), previous]
        return result, current_company_id
    if debited_at:
        return result, current_company_id
    if result.get('last_analysis_error'):
        return result, current_company_id
    plate = result.get('plate')
    reviewed = (result.get('plate_validation') or {}).get('plate') == plate and bool(plate)
    reliable = reviewed or float(result.get('plate_confidence') or 0) >= 0.9
    matched = (association and association.get('plate') == plate and reliable)
    previous = result.get('company_assignment')
    if matched and previous and previous.get('plate') == plate and previous.get('company_id') == association['company_id']:
        return result, association['company_id']
    original_company_id = previous.get('previous_company_id') if previous else current_company_id
    if previous:
        result['company_assignment_history'] = [*result.get('company_assignment_history', []), previous]
        result.pop('company_assignment', None)
    if not matched:
        return result, original_company_id
    result['company_assignment'] = {
        'source': 'confirmed_plate', 'plate': plate,
        'company_id': association['company_id'], 'company_name': association['company_name'],
        'previous_company_id': original_company_id,
        'assigned_at': datetime.now(timezone.utc).isoformat(),
    }
    return result, association['company_id']
