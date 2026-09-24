'use strict';
const Database=require('better-sqlite3');
const fs=require('fs'),path=require('path'),{randomUUID,createHash}=require('crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
class Store {
 constructor(dir,station,{flowLpm=600,maxRosterHours=72,maxSampleGapMs=5000,now=Date.now}={}) {
  this.station=String(station);this.now=now;this.flowLpm=flowLpm;this.maxRosterHours=maxRosterHours;this.gap=maxSampleGapMs;
  if(!Number.isFinite(flowLpm)||flowLpm<=0||!Number.isFinite(maxRosterHours)||maxRosterHours<=0)throw Error('Configuración local inválida');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});this.dir=dir;this.photos=path.join(dir,'photos');fs.mkdirSync(this.photos,{recursive:true,mode:0o700});
  this.db=new Database(path.join(dir,'cargas.sqlite'));this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 5000');
  this.db.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS loads(id TEXT PRIMARY KEY,station TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,acked INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT);
   CREATE TABLE IF NOT EXISTS photos(load_id TEXT NOT NULL,sha TEXT NOT NULL,mime TEXT NOT NULL,file TEXT NOT NULL,PRIMARY KEY(load_id,sha));
   CREATE TABLE IF NOT EXISTS seen(k TEXT PRIMARY KEY,ts INTEGER NOT NULL);`);
  const previous=this.get('station');if(previous&&previous!==this.station)throw Error('La carpeta local pertenece a otra estación');this.set('station',this.station);
  const a=this.active();if(a){a.review_reasons=[...new Set([...a.review_reasons,'reinicio_durante_carga'])];a.last_sample_ms=null;this.save(a);}
 }
 get(k){const r=this.db.prepare('SELECT v FROM kv WHERE k=?').get(k);return r?JSON.parse(r.v):null;}
 set(k,v){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
 active(){const id=this.get('active');return id?this.read(id):null;}
 read(id){const r=this.db.prepare('SELECT body FROM loads WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
 save(a){a.revision=(a.revision||0)+1;a.liters=Number(a.liters.toFixed(6));this.db.prepare('INSERT INTO loads(id,station,body,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision').run(a.local_id,this.station,JSON.stringify(a),a.revision);return a;}
 inventory(p){
  if(!p||p.version!==2||p.ok!==true||p.complete!==true||p.station_id!==this.station||!Array.isArray(p.items)||p.count!==p.items.length)throw Error('Padrón incompleto o de otra estación: se conserva el anterior');
  const nos=new Set(),cards=new Set();
  const items=p.items.map(u=>{
   if(!u||typeof u.employeeNo!=='string'||nos.has(u.employeeNo)||!['driver','company'].includes(u.kind)||typeof u.active!=='boolean'||!Array.isArray(u.cards))throw Error('Padrón inválido');nos.add(u.employeeNo);
   for(const c of u.cards){if(typeof c!=='string'||cards.has(c))throw Error('Tarjeta inválida o duplicada');cards.add(c);}
   return {employeeNo:u.employeeNo,name:u.name,kind:u.kind,active:u.active,company_code:u.company_code,pin_user_id:u.pin_user_id,cards:u.cards,valid_until:u.valid_until||null};
  });
  this.set('roster',{received_ms:this.now(),generated_at:p.generated_at,items});return items.length;
 }
 create(identity={},reasons=[]){
  const a={local_id:randomUUID(),station_id:this.station,started_at:new Date(this.now()).toISOString(),ended_at:null,employee_no:identity.employee_no||'',card_no:identity.card_no||'',company_code:identity.company_code||'',pin_user_id:identity.pin_user_id||null,access_method:identity.access_method||'manual',roster_generated_at:identity.roster_generated_at||null,liters:0,flow_l_min:this.flowLpm,meter_method:'time_estimate',review_reasons:reasons,last_sample_ms:null,last_on:false,has_run:false,revision:0};
  this.save(a);this.set('active',a.local_id);return a;
 }
 access(e,eventTime=''){
  const major=Number(e.majorEventType),sub=Number(e.subEventType),mode=String(e.currentVerifyMode||e.verifyMode||'').toLowerCase();
  const card=String(e.cardNo||'').trim(),no=String(e.employeeNoString||e.employeeNo||'').trim();
  const rfid=major===5&&!!card&&card!=='0'&&(sub===1||(sub===75&&mode.includes('card')));
  const pin=major===5&&sub===181&&(mode.includes('pw')||mode.includes('password'));
  if((!rfid&&!pin)||(e.statusValue!==undefined&&![0,1].includes(Number(e.statusValue))))return null;
  return this.db.transaction(()=>{
   const now=this.now(),key=[no,card,e.serialNo||e.verifyNo||'',eventTime].join('|');
   const seen=this.db.prepare('SELECT ts FROM seen WHERE k=?').get(key);if(seen&&now-seen.ts<(eventTime?300000:3000))return null;
   this.db.prepare('DELETE FROM seen WHERE ts<?').run(now-300000);this.db.prepare('INSERT OR REPLACE INTO seen VALUES(?,?)').run(key,now);
   const roster=this.get('roster'),list=roster?.items||[];
   let u=list.find(x=>x.employeeNo===no);
   if(!u&&!no&&rfid){const matches=list.filter(x=>x.kind==='driver'&&x.cards.includes(card));if(matches.length===1)u=matches[0];}
   const reasons=[];
   if(!roster||now-roster.received_ms>this.maxRosterHours*3600000)reasons.push('padron_ausente_o_vencido');
   if(!u||!u.active||(rfid&&(u.kind!=='driver'||!u.cards.includes(card)))||(pin&&u.kind!=='company')||(u?.valid_until&&Date.parse(u.valid_until)<=now))reasons.push('identidad_no_habilitada_en_padron');
   // Record accepted device events even when the local roster cannot authorize them.
   // This node is a recorder; it does not operate the keypad relay.
   const identity={employee_no:rfid?(u?.employeeNo||no):'',card_no:rfid?card:'',company_code:u?.company_code||'',pin_user_id:u?.pin_user_id||null,access_method:rfid?'rfid':'company_pin',roster_generated_at:roster?.generated_at||null};
   let a=this.active();
   if(a){
    if(a.access_method==='manual'&&now-Date.parse(a.started_at)<10000){Object.assign(a,identity);a.review_reasons=[...new Set([...a.review_reasons,...reasons])];this.save(a);return {load:a,capture:false};}
    return null;
   }
   a=this.create(identity,reasons);return {load:a,capture:true};
  })();
 }
 meter(on){
  if(typeof on!=='boolean')throw Error('Estado de bomba inválido');
  return this.db.transaction(()=>{
   const now=this.now();let a=this.active(),capture=false;
   if(!a&&on){a=this.create();capture=true;}if(!a)return null;
   if(a.last_on&&a.last_sample_ms!==null){const dt=now-a.last_sample_ms;if(dt>=0&&dt<=this.gap)a.liters+=dt/60000*a.flow_l_min;else a.review_reasons=[...new Set([...a.review_reasons,'intervalo_sin_medicion'])];}
   a.last_sample_ms=now;a.last_on=on;
   if(on)a.has_run=true;
   if(!on&&a.has_run){a.ended_at=new Date(now).toISOString();this.set('active',null);}
   this.save(a);return {load:a,capture};
  })();
 }
 tick(){
  const a=this.active();if(!a)return;
  if(a.has_run&&a.last_sample_ms&&this.now()-a.last_sample_ms>this.gap&&!a.review_reasons.includes('intervalo_sin_medicion')){a.review_reasons.push('intervalo_sin_medicion');this.save(a);}
  if(!a.has_run&&this.now()-Date.parse(a.started_at)>120000){a.ended_at=new Date(this.now()).toISOString();a.review_reasons.push('sin_arranque_observado');this.db.transaction(()=>{this.save(a);this.set('active',null);})();}
 }
 photo(id,buffer,mime='image/jpeg'){
  if(!this.read(id))throw Error('Foto sin carga local');if(!Buffer.isBuffer(buffer)||buffer.length<1000||buffer.length>15*1024*1024)throw Error('Tamaño de foto inválido');
  if(!['image/jpeg','image/png'].includes(mime))throw Error('Formato de foto inválido');
  const sha=hash(buffer),file=path.join(this.photos,sha+(mime==='image/png'?'.png':'.jpg'));
  // fsync before committing the photo reference; a crash leaves at most an orphan file.
  if(!fs.existsSync(file)){const temp=file+'.'+randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,buffer);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);if(process.platform!=='win32'){const d=fs.openSync(this.photos,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}}
  this.db.transaction(()=>{const r=this.db.prepare('INSERT OR IGNORE INTO photos VALUES(?,?,?,?)').run(id,sha,mime,file);if(r.changes)this.save(this.read(id));})();return sha;
 }
 photoFailure(id){const a=this.read(id);if(a&&!a.review_reasons.includes('foto_no_disponible')){a.review_reasons.push('foto_no_disponible');this.save(a);}}
 pending(){return this.db.prepare('SELECT id,revision FROM loads WHERE revision>acked AND last_attempt<=? ORDER BY last_attempt,id LIMIT 20').all(this.now()-15000);}
 snapshot(id){const a=this.read(id);if(!a)return null;const photos=this.db.prepare('SELECT sha,mime,file FROM photos WHERE load_id=? ORDER BY sha').all(id);const {last_on,last_sample_ms,has_run,...body}=a;body.photos=photos.map(({sha,mime})=>({sha,mime}));return {body,photos};}
 attempt(id,error=null){this.db.prepare('UPDATE loads SET last_attempt=?,last_error=? WHERE id=?').run(this.now(),error,id);}
 ack(id,revision){this.db.prepare('UPDATE loads SET acked=MAX(acked,?),last_error=NULL WHERE id=? AND revision>=?').run(revision,id,revision);}
 status(){return this.db.prepare('SELECT count(*) AS total,sum(CASE WHEN revision>acked THEN 1 ELSE 0 END) AS pending FROM loads').get();}
 close(){this.db.close();}
}
module.exports={Store,hash};
