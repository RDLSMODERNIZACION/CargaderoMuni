'use strict';
const path=require('path');const {Store}=require('./store');const {uploadOne}=require('./uploader');
function bool(v){if(v===true||v===1||v==='true'||v==='1')return true;if(v===false||v===0||v==='false'||v==='0')return false;if(v&&typeof v==='object'){for(const k of ['Bomba','value','state','payload'])if(k in v)return bool(v[k]);}return null;}
module.exports=function(RED){
 function Offline(config){
  RED.nodes.createNode(this,config);const node=this,flow=node.context().flow;let store,busy=false,closing=false,inFlight=null;
  const emit=(kind,extra={})=>node.send([null,{payload:{kind,...extra}}]);
  const state=()=>{const s=store.status(),a=store.active();flow.set('current_dispatch_id',a?.local_id||null);flow.set('dispatch_start_pending',false);node.status({fill:s.pending?'yellow':'green',shape:'dot',text:(a?'Carga local en curso · ':'')+(s.pending||0)+' pendientes'});};
  try{const station=String(config.station||'2');const dir=config.directory?path.resolve(config.directory):path.join(RED.settings.userDir,'cargadero-offline','station-'+station);store=new Store(dir,station,{flowLpm:Number(config.flowLpm||600),maxRosterHours:Number(config.maxRosterHours||72)});state();}
  catch(e){node.status({fill:'red',shape:'ring',text:'No se pudo abrir registro local'});node.error(e);return;}
  const capture=r=>{if(r?.capture)node.send([{capture_id:r.load.local_id,payload:null},null]);if(r)state();};
  node.on('input',(msg,send,done)=>{
   try{
    if(msg.offline_action==='inventory'){const n=store.inventory(msg.payload);emit('PADRON_GUARDADO',{usuarios:n});}
    else if(msg.offline_action==='access'){capture(store.access(msg.payload||{},msg.event_time||''));}
    else if(msg.offline_action==='meter'){const v=bool(msg.payload);if(v!==null)capture(store.meter(v));}
    else if(msg.offline_action==='photo'){
     const p=msg.payload||{};const id=p.capture_id||msg.capture_id;
     if(p.ok&&p.file){store.photo(id,p.file.value,p.file.options?.contentType||'image/jpeg');emit('FOTO_LOCAL_GUARDADA',{local_id:id});}
     else if(id)store.photoFailure(id);
    }
    else if(msg.offline_action==='status')emit('ESTADO_LOCAL',store.status());
    state();if(done)done();
   }catch(e){node.status({fill:'red',shape:'ring',text:'ERROR guardado local'});emit('ERROR_LOCAL',{message:e.message});if(done)done(e);else node.error(e);}
  });
  const sync=async()=>{
   if(busy||closing)return;busy=true;
   try{
    store.tick();state();
    for(const r of store.pending()){
     if(closing)break;inFlight=new AbortController();const timer=setTimeout(()=>inFlight?.abort(),45000);
     try{const a=await uploadOne(store,r.id,config.backend||'https://cargaderomuni.onrender.com',fetch,inFlight.signal);emit('CARGA_CONFIRMADA_SERVIDOR',{local_id:r.id,id:a.id,revision:a.revision});}
     catch(e){emit('PENDIENTE_REINTENTO',{local_id:r.id,message:e.message});}
     finally{clearTimeout(timer);inFlight=null;}
    }
   }finally{busy=false;if(!closing)state();}
  };
  const interval=setInterval(sync,5000);setImmediate(sync);
  node.on('close',(_removed,done)=>{closing=true;clearInterval(interval);inFlight?.abort();const finish=()=>{if(busy){setTimeout(finish,25);return;}store.close();done();};finish();});
 }
 RED.nodes.registerType('cargadero-offline',Offline);
};
