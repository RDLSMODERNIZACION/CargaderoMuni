const fs=require('fs'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/sync.js','utf8');
const eventCode=fs.readFileSync(__dirname+'/event.js','utf8');
const cfg={hik_ip:'192.0.2.1',station_id:'3',timeoutMs:1000,beginTime:'2025-01-01T00:00:00',endTime:'2037-12-31T23:59:59',disabledBeginTime:'2000-01-01T00:00:00',disabledEndTime:'2000-01-02T00:00:00'};
const companies=[{employeeNo:'3',name:'KOMPASS',kind:'company',password:'secret-pin',active:true,cards:[],company_code:'3'}];
const driver={employeeNo:'DRIVER-2',name:'VICTOR',kind:'driver',active:true,cards:['00123'],company_code:'3',pin_user_id:2};
function setup(){
 const ctx=new Map(),flowMap=new Map([['hik_config',cfg]]), flow={get:k=>flowMap.get(k),set:(k,v)=>flowMap.set(k,v)};
 const node={status(){},send(){},warn(){},error(){}};
 return {flow,invoke:msg=>new Function('msg','context','flow','node',code)(msg,{get:k=>ctx.get(k),set:(k,v)=>ctx.set(k,v)},flow,node)};
}
function run(items,{failCard=false,existing=true}={}){
 const h=setup(), users=new Map(existing?[['DRIVER-2',{employeeNo:'DRIVER-2',name:'OLD'}],['4',{employeeNo:'4',name:'STALE'}],['admin',{employeeNo:'admin',name:'ADMIN'}]]:[]);
 const cards=new Map(existing?[['old-card','DRIVER-2']]:[]),calls=[];
 let out=h.invoke({sync_start:true,payload:{ok:true,complete:true,version:2,station_id:'3',count:items.length,items}});
 for(let i=0;out&&out[1]&&i<100;i++){
  const req=out[1],p=JSON.parse(req.payload),url=req.url;calls.push({url,p});
  let body={statusCode:1,statusString:'OK'},status=200;
  if(url.includes('/UserInfo/Search')){
   const c=p.UserInfoSearchCond,ids=c.EmployeeNoList?.map(u=>u.employeeNo);
   const rows=[...users.values()].filter(u=>!ids||ids.includes(u.employeeNo));
   const page=rows.slice(c.searchResultPosition,c.searchResultPosition+2);
   body={UserInfoSearch:{totalMatches:rows.length,numOfMatches:page.length,responseStatusStrg:page.length?'OK':'NO MATCH',UserInfo:page}};
  }else if(url.includes('/CardInfo/Search')){
   const c=p.CardInfoSearchCond;const rows=[...cards].filter(([n,o])=>o===c.EmployeeNoList[0].employeeNo).map(([cardNo,employeeNo])=>({cardNo,employeeNo}));
   const page=rows.slice(c.searchResultPosition,c.searchResultPosition+2);
   body={CardInfoSearch:{totalMatches:rows.length,numOfMatches:page.length,responseStatusStrg:page.length?'OK':'NO MATCH',CardInfo:page}};
  }else if(url.includes('/UserInfo/')){
   assert(!url.includes('/Delete'),'must not delete users');users.set(p.UserInfo.employeeNo,p.UserInfo);
  }else if(failCard){body={statusCode:4,statusString:'Invalid Operation',subStatusCode:'testFailure'};}
  else if(url.includes('/CardInfo/Delete')){cards.delete(p.CardInfoDelCond.CardNoList[0].cardNo);}
  else if(url.includes('/CardInfo/Record')){assert(!cards.has(p.CardInfo.cardNo) || cards.get(p.CardInfo.cardNo)===p.CardInfo.employeeNo,'card belongs to old owner');cards.set(p.CardInfo.cardNo,p.CardInfo.employeeNo);}
  else throw Error('unexpected '+url);
  out=h.invoke({...req,statusCode:status,payload:body});
 }
 return {out,users,cards,calls,h};
}
let r=run([...companies,driver]);
assert(r.out[0].payload.ok);assert.equal(r.cards.get('00123'),'DRIVER-2');assert(!r.cards.has('old-card'));
assert.equal(r.users.get('DRIVER-2').Valid.endTime,cfg.endTime);assert.equal(r.users.get('4').Valid.endTime,cfg.disabledEndTime);assert(!r.users.get('admin').Valid);
assert(!JSON.stringify(r.out).includes('secret-pin'));
r=run([...companies,driver],{existing:false});assert(r.out[0].payload.ok);assert(r.users.has('DRIVER-2'));
r=run([...companies,driver],{failCard:true});assert(r.out[2]);assert.equal(r.users.get('DRIVER-2').Valid.endTime,cfg.disabledEndTime);
r=run([...companies,{...driver,active:false,cards:[]}]);assert(r.out[0].payload.ok);assert.equal(r.cards.size,0);assert.equal(r.users.get('DRIVER-2').Valid.endTime,cfg.disabledEndTime);
r=run([...companies,{...driver,employeeNo:'DRIVER-1',cards:['old-card']},{...driver,cards:['00123']}]);assert(r.out[0].payload.ok);assert.equal(r.cards.get('old-card'),'DRIVER-1');
const h=setup();assert(h.invoke({sync_start:true,payload:{ok:true,items:[]}})[2]);
const eh=setup();eh.flow.set('hik_identities',{'DRIVER-2':driver,'3':companies[0]});eh.flow.set('hik_identities_at',Date.now());
const ev=m=>new Function('msg','flow','node',eventCode)(m,eh.flow,{status(){}});
assert.equal(ev({payload:{majorEventType:5,subEventType:9,employeeNoString:'DRIVER-2',cardNo:'00123'}}),null);
assert.equal(ev({payload:{majorEventType:5,subEventType:1,employeeNoString:'DRIVER-2',cardNo:'wrong'}}),null);
let event=ev({payload:{majorEventType:5,subEventType:1,employeeNoString:'DRIVER-2',cardNo:'00123'}});
assert.equal(event[0].company_code,'3');assert.equal(event[0].employee_no,'DRIVER-2');assert.equal(event[0].access_method,'rfid');
assert.equal(ev({payload:{majorEventType:5,subEventType:1,employeeNoString:'DRIVER-2',cardNo:'00123'}}),null);
const flow=JSON.parse(fs.readFileSync(__dirname+'/../Cargadero_RFID_camioneros.json','utf8'));
const ids=new Set(flow.map(n=>n.id));assert.equal(ids.size,flow.length);
for(const n of flow){for(const w of n.wires||[])for(const id of w)assert(ids.has(id),'broken wire '+id);if(n.type==='function')new Function('msg','flow','node','context','env','RED',n.func);}
console.log('PASS: create, update, rotate, deactivate, orphan expiry, pagination, failure isolation, RFID rejection/dedup, JSON functions and wiring');
