const e=msg.payload || {}, cfg=flow.get('hik_config') || {};
const no=String(e.employeeNoString || e.employeeNo || '').trim();
const card=String(e.cardNo || '').trim();
const major=Number(e.majorEventType), sub=Number(e.subEventType);
const mode=String(e.currentVerifyMode || e.verifyMode || '').toLowerCase();
const isCard=major===5 && !!card && card!=='0' && (sub===1 || (sub===75 && mode.includes('card')));
const isPin=major===5 && sub===181 && (mode.includes('pw') || mode.includes('password'));
if(!isCard && !isPin)return null;
if(e.statusValue!==undefined && ![0,1].includes(Number(e.statusValue)))return null;
const ids=flow.get('hik_identities') || {};
let identity=ids[no], employeeNo=no;
if(isCard && !identity) {
    const matches=Object.entries(ids).filter(([k,u])=>u.kind==='driver' && u.active && u.cards.includes(card));
    if(matches.length===1 && !no){employeeNo=matches[0][0];identity=matches[0][1];}
}
if(!identity || !identity.active || Date.now()-Number(flow.get('hik_identities_at') || 0)>600000) {
    node.status({fill:'yellow',shape:'ring',text:'Usuario sin inventario vigente'});return null;
}
if(isCard && (identity.kind!=='driver' || !identity.cards.includes(card)))return null;
if(isPin && identity.kind!=='company')return null;
if(cfg.test_mode===true) {
    node.status({fill:'green',shape:'dot',text:'PRUEBA OK: '+employeeNo+' → '+identity.company_code});
    return [null,{payload:{test:true,employeeNo,pin_user_id:identity.pin_user_id,company_code:identity.company_code,method:isCard?'rfid':'company_pin'}}];
}
if(flow.get('current_dispatch_id') || flow.get('dispatch_start_pending'))return null;
const now=Date.now(), seen=flow.get('hik_seen') || {};
for(const k of Object.keys(seen))if(now-seen[k]>300000)delete seen[k];
const eventTs=(msg.ev || {}).dateTime || '';
const key=[employeeNo,e.serialNo || e.verifyNo || '',eventTs].join('|');
if(seen[key] && now-seen[key]<(eventTs?300000:3000))return null;
seen[key]=now;flow.set('hik_seen',seen);
flow.set('dispatch_start_pending',true);flow.set('dispatch_start_source',isCard?'rfid':'pin');
flow.set('last_pin_ok_ts',now);
msg.company_code=identity.company_code;msg.station_id=String(cfg.station_id);
msg.employee_no=isCard?employeeNo:'';msg.card_no=isCard?card:'';
msg.pin_user_id=identity.pin_user_id;msg.access_method=isCard?'rfid':'company_pin';
msg.dispatch_source=isCard?'rfid':'pin';
return [msg,null];
