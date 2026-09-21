// Four outputs: sanitized result, Digest request, sanitized error, health response.
// Serial requests: no user is deleted/recreated during ordinary synchronization.
if (msg.hik_action === 'health_probe') return [null,null,null,msg];
let s = context.get('run');
const cfg = flow.get('hik_config') || {};
function fail(reason) {
    const who = s && s.user ? s.user.employeeNo : null;
    const timer = context.get('watchdog'); if (timer) clearTimeout(timer);
    context.set('watchdog', null); context.set('run', null);
    flow.set('hik_sync_running', false);
    node.status({fill:'red',shape:'ring',text:reason});
    return [null,null,{payload:{ok:false,reason,employeeNo:who}},null];
}
function request(action, method, path, payload) {
    s.action = action; context.set('run',s);
    const old = context.get('watchdog'); if (old) clearTimeout(old);
    context.set('watchdog',setTimeout(()=> {
        const current=context.get('run');
        if(current && current.id===s.id) node.send(fail('Timeout de sincronización: '+action));
    }, Number(cfg.timeoutMs || 10000)+5000));
    return [null,{sync_run:s.id,hik_action:'sync_v2',method,
        url:'http://'+cfg.hik_ip+path+'?format=json',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        requestTimeout:Number(cfg.timeoutMs || 10000),payload:JSON.stringify(payload)},null,null];
}
function localTime(v) {
    const d=new Date(v), pad=x=>String(x).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function userBody(enabled) {
    const u=s.user;
    const info={employeeNo:u.employeeNo,name:u.name,userType:'normal',
        doorRight:cfg.doorRight || '1',RightPlan:[{doorNo:Number(cfg.doorNo || 1),planTemplateNo:String(cfg.planTemplateNo || '1')}],
        Valid:{enable:true,timeType:'local',beginTime:enabled?cfg.beginTime:cfg.disabledBeginTime,
            endTime:enabled?(u.valid_until?localTime(u.valid_until):cfg.endTime):cfg.disabledEndTime}};
    if(u.kind==='driver') info.userVerifyMode='card';
    if(u.kind==='company' && u.password) {info.password=u.password;info.localPassword=u.password;}
    return {UserInfo:info};
}
function allUsers() {
    return request('inventory','POST','/ISAPI/AccessControl/UserInfo/Search',{
        UserInfoSearchCond:{searchID:s.id,searchResultPosition:s.position,maxResults:100}});
}
function searchCards(action) {
    return request(action,'POST','/ISAPI/AccessControl/CardInfo/Search',{
        CardInfoSearchCond:{searchID:s.id+'-cards-'+s.index+'-'+action,searchResultPosition:s.position,
            maxResults:100,EmployeeNoList:[{employeeNo:s.user.employeeNo}]}});
}
function startUser() {
    s.index++;
    if(s.index>=s.jobs.length) {
        const summary={ok:true,action:'sync_v2',processed:s.desired.length,operations:s.jobs.length,drivers:s.desired.filter(u=>u.kind==='driver').length,
            disabled_orphans:s.orphans};
        context.set('run',null); flow.set('hik_sync_running',false);
        node.status({fill:'green',shape:'dot',text:'Sincronizados: '+s.jobs.length});
        return [{payload:summary},null,null,null];
    }
    s.user=s.jobs[s.index];
    node.status({fill:'blue',shape:'dot',text:'Sincronizando '+s.user.employeeNo});
    const exists=s.existing.some(u=>u.employeeNo===s.user.employeeNo);
    const method=exists?'PUT':'POST', path=exists?'Modify':'Record';
    return request('user_write',method,'/ISAPI/AccessControl/UserInfo/'+path,
        userBody(s.user.kind==='company' && s.user.active));
}
function cardJob() {
    const job=s.cardJobs.shift();
    if(!job) {s.position=0;s.cards=[];return searchCards('verify_cards');}
    if(job.action==='delete') return request('card_write','PUT','/ISAPI/AccessControl/CardInfo/Delete',{
        CardInfoDelCond:{CardNoList:[{cardNo:job.cardNo}]}});
    return request('card_write','POST','/ISAPI/AccessControl/CardInfo/Record',{
        CardInfo:{employeeNo:s.user.employeeNo,cardNo:job.cardNo,cardType:'normalCard'}});
}
function verifyUser() {
    return request('verify_user','POST','/ISAPI/AccessControl/UserInfo/Search',{
        UserInfoSearchCond:{searchID:s.id+'-verify-'+s.index,searchResultPosition:0,maxResults:10,
            EmployeeNoList:[{employeeNo:s.user.employeeNo}]}});
}
if(msg.sync_start===true) {
    if(s) return [null,null,{payload:{ok:false,reason:'Sincronización en curso'}},null];
    const p=msg.payload;
    if(!p || p.ok!==true || p.version!==2 || p.complete!==true || !Array.isArray(p.items) ||
       p.count!==p.items.length || p.station_id!==String(cfg.station_id)) return fail('Inventario incompleto o estación incorrecta');
    const nos=new Set(), cards=new Set();
    for(const u of p.items) {
        if(!u || typeof u.employeeNo!=='string' || !u.employeeNo || nos.has(u.employeeNo) ||
           !['company','driver'].includes(u.kind) || typeof u.active!=='boolean' || !Array.isArray(u.cards) ||
           typeof u.name!=='string' || (u.kind==='company' && !u.password) ||
           (u.kind==='driver' && (!/^DRIVER-\d+$/.test(u.employeeNo) || (u.active && (!u.company_code || !u.cards.length))))) return fail('Usuario inválido en inventario');
        nos.add(u.employeeNo);
        for(const c of u.cards) {if(typeof c!=='string' || !c || cards.has(c))return fail('RFID vacío o duplicado');cards.add(c);}
    }
    const identities={};for(const u of p.items)identities[u.employeeNo]={kind:u.kind,company_code:u.company_code,pin_user_id:u.pin_user_id,active:u.active,cards:u.cards};
    flow.set('hik_identities',identities);flow.set('hik_identities_at',Date.now());
    s={id:'sync-'+Date.now(),desired:p.items,existing:[],position:0,index:-1,orphans:0};
    flow.set('hik_sync_running',true);
    return allUsers();
}
if(!s || msg.sync_run!==s.id) return null; // Ignore late replies from an expired run.
const timer=context.get('watchdog');if(timer)clearTimeout(timer);context.set('watchdog',null);
let b=msg.payload;
try {if(typeof b==='string')b=JSON.parse(b);}catch(e){return fail('Respuesta HIK no JSON en '+s.action);}
if(msg.error || Number(msg.statusCode)<200 || Number(msg.statusCode)>=300 || !b || typeof b!=='object')return fail('Error HTTP '+String(msg.statusCode || '')+' en '+s.action);
const action=s.action;
if(['inventory','cards','verify_cards','verify_user'].includes(action)) {
    const r=action==='cards'||action==='verify_cards'?b.CardInfoSearch:b.UserInfoSearch;
    const key=action==='cards'||action==='verify_cards'?'CardInfo':'UserInfo';
    if(!r || !Number.isInteger(r.totalMatches) || !Number.isInteger(r.numOfMatches) ||
       !['OK','MORE','NO MATCH'].includes(r.responseStatusStrg) ||
       (r.numOfMatches>0 && !Array.isArray(r[key])))return fail('Búsqueda HIK inválida en '+action);
    const list=r[key] || [];
    if(list.length!==r.numOfMatches || (list.length===0 && r.totalMatches>(s.position || 0)))return fail('Paginación HIK incompleta');
    if(action==='verify_user') {
        const u=list.find(u=>u.employeeNo===s.user.employeeNo);
        const expected=userBody(s.user.active).UserInfo;
        if(!u || u.name!==expected.name || !u.Valid || u.Valid.enable!==true ||
           String(u.Valid.endTime).slice(0,19)!==expected.Valid.endTime)return fail('No se confirmó nombre/vigencia del usuario');
        return startUser();
    }
    if(action==='inventory')s.existing.push(...list);else {
        if(list.some(c=>c.employeeNo!==s.user.employeeNo || typeof c.cardNo!=='string'))return fail('Tarjetas de otro usuario o formato inválido');
        s.cards.push(...list);
    }
    s.position+=list.length;
    if(s.position<r.totalMatches)return action==='inventory'?allUsers():searchCards(action);
    if(s.position!==r.totalMatches)return fail('Inventario HIK cambió durante la lectura');
    if(action==='inventory') {
        const keep=new Set(s.desired.map(u=>u.employeeNo));
        const stale=s.existing.filter(u=>(/^DRIVER-\d+$/.test(u.employeeNo) || /^\d+$/.test(u.employeeNo)) && !keep.has(u.employeeNo));
        // Orphans are expired, not deleted: prevents credential loss during migration.
        s.orphans=stale.length;
        const revoked=stale.map(u=>({employeeNo:u.employeeNo,name:u.name,
            kind:/^DRIVER-\d+$/.test(u.employeeNo)?'driver':'orphan',active:false,cards:[],phase:'revoke'}));
        const drivers=s.desired.filter(u=>u.kind==='driver');
        // Revoke obsolete cards for ALL drivers before assigning cards to new owners.
        s.jobs=revoked.concat(s.desired.filter(u=>u.kind==='company'),
            drivers.map(u=>({...u,phase:'revoke'})),drivers.map(u=>({...u,phase:'apply'})));
        return startUser();
    }
    const wanted=s.user.active?s.user.cards:[], have=s.cards.map(c=>c.cardNo);
    if(action==='cards') {
        s.cardJobs=have.filter(c=>!wanted.includes(c)).map(cardNo=>({action:'delete',cardNo}))
            .concat(s.user.phase==='revoke'?[]:wanted.filter(c=>!have.includes(c)).map(cardNo=>({action:'add',cardNo})));
        return cardJob();
    }
    if(s.user.phase==='revoke') {
        if(have.some(c=>!wanted.includes(c)))return fail('No se confirmó la baja de tarjeta');
        return startUser();
    }
    if(have.length!==wanted.length || wanted.some(c=>!have.includes(c)))return fail('No se confirmaron las tarjetas');
    return request('user_enable','PUT','/ISAPI/AccessControl/UserInfo/Modify',userBody(s.user.active));
}
if(Number(b.statusCode)!==1 || String(b.statusString).toUpperCase()!=='OK')return fail('HIK rechazó '+action+': '+String(b.subStatusCode || b.statusCode));
if(action==='user_write') {
    if(s.user.kind==='driver'){s.position=0;s.cards=[];return searchCards('cards');}
    return verifyUser();
}
if(action==='card_write')return cardJob();
if(action==='user_enable')return verifyUser();
return fail('Estado desconocido');
