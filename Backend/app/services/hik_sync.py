"""Station-scoped RFID inventory and dispatch identity; no device credentials logged."""
from datetime import datetime, timezone

from fastapi import HTTPException


def build_inventory(companies, drivers, credentials, station_id, now=None):
    now = now or datetime.now(timezone.utc)
    items = []
    for code, name, pin, active in companies:
        items.append(dict(employeeNo=str(code), name=name, password=pin,
                          active=bool(active), kind="company", company_code=str(code),
                          pin_user_id=None, cards=[]))
    for user_id, name, enabled, employee_no, company_code, company_active in drivers:
        cards = []
        ends = []
        for owner, card, active, station, begin, end in credentials:
            if owner != user_id or (station is not None and station != station_id):
                continue
            if active and card and (begin is None or begin <= now) and (end is None or end > now):
                cards.append(str(card).strip())
                if end:
                    ends.append(end)
        active = bool(enabled and company_code and company_active and cards)
        items.append(dict(employeeNo=employee_no or f"DRIVER-{user_id}", name=name,
                          password=None, active=active, kind="driver", company_code=company_code,
                          pin_user_id=user_id, cards=sorted(set(cards)) if active else [],
                          valid_until=min(ends).isoformat() if ends and active else None))
    employees, cards = set(), set()
    for item in items:
        no = item["employeeNo"]
        if not no or len(no) > 32 or no in employees:
            raise HTTPException(409, "Duplicate or invalid device_employee_no")
        employees.add(no)
        for card in item["cards"]:
            if card in cards:
                raise HTTPException(409, "RFID assigned to multiple drivers")
            cards.add(card)
    return dict(ok=True, version=2, complete=True, station_id=station_id,
                count=len(items), items=items, generated_at=now.isoformat())


async def load_inventory(cur, station_id):
    await cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
    await cur.execute("SELECT 1 FROM public.station WHERE id=%s AND active", (station_id,))
    if not await cur.fetchone():
        raise HTTPException(404, "Station not found or inactive")
    await cur.execute("""SELECT code,name,pin,active FROM public.company
        WHERE NULLIF(trim(code),'') IS NOT NULL AND NULLIF(pin,'') IS NOT NULL ORDER BY code""")
    companies = await cur.fetchall()
    await cur.execute("""SELECT p.id,p.name,p.enabled,p.device_employee_no,c.code,c.active
        FROM public.pin_user p LEFT JOIN public.company c ON c.id=p.company_id ORDER BY p.id""")
    drivers = await cur.fetchall()
    await cur.execute("""SELECT pin_user_id,value,active,station_id,valid_from,valid_until
        FROM public.access_credential WHERE kind IN ('rfid','card') ORDER BY id""")
    credentials = await cur.fetchall()
    return build_inventory(companies, drivers, credentials, station_id)


async def resolve_driver(cur, station_id, employee_no, card_no, company_code=None):
    if not employee_no or not card_no:
        raise HTTPException(422, "RFID requires employee_no and card_no")
    await cur.execute("""SELECT DISTINCT p.id,c.id,c.code
        FROM public.pin_user p
        JOIN public.company c ON c.id=p.company_id
        JOIN public.access_credential a ON a.pin_user_id=p.id
        JOIN public.station s ON s.id=%s AND s.active
        WHERE COALESCE(NULLIF(p.device_employee_no,''),'DRIVER-' || p.id::text)=%s
          AND trim(a.value)=%s AND a.kind IN ('rfid','card')
          AND p.enabled AND c.active AND a.active
          AND (a.station_id IS NULL OR a.station_id=s.id)
          AND (a.valid_from IS NULL OR a.valid_from<=now())
          AND (a.valid_until IS NULL OR a.valid_until>now())""",
        (station_id, employee_no, card_no))
    rows = await cur.fetchall()
    if len(rows) != 1:
        raise HTTPException(403, "RFID or driver not authorized for this station")
    user_id, company_id, actual_code = rows[0]
    if company_code and company_code != actual_code:
        raise HTTPException(409, "Driver/company mismatch")
    return user_id, company_id, actual_code
