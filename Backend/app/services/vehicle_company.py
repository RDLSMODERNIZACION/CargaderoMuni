"""Verified plate associations and independent visual company evidence."""
import re
import unicodedata


def company_key(value):
    text = unicodedata.normalize('NFKD', value or '')
    text = ''.join(c for c in text if not unicodedata.combining(c)).upper()
    # Only separate legal suffixes, never fuzzy/substring matching.
    text = re.sub(r'\s+(?:S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?)\s*$', '', text)
    return re.sub(r'[^A-Z0-9]', '', text)


def company_check(analysis, association=None, expected_company=None):
    result = dict(analysis)
    visible = (analysis.get('company_visible') or '').strip()
    confidence = float(analysis.get('company_confidence') or 0)
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
