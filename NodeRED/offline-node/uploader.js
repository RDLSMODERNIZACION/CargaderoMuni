'use strict';
const fs=require('fs');
async function uploadOne(store,id,base,fetcher=fetch,signal){
 const snap=store.snapshot(id);if(!snap)return;
 store.attempt(id);
 const form=new FormData();form.append('record',JSON.stringify(snap.body));
 const confirmed=store.get('photos_ack_'+id)||[];
 for(const p of snap.photos)if(!confirmed.includes(p.sha))form.append('photo_'+p.sha,new Blob([fs.readFileSync(p.file)],{type:p.mime}),p.sha+'.'+(p.mime==='image/png'?'png':'jpg'));
 try{
  const r=await fetcher(base.replace(/\/$/,'')+'/water/offline/sync',{method:'POST',body:form,signal:signal||AbortSignal.timeout(45000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const a=await r.json();
  if(a.ok!==true||a.local_id!==id||a.revision!==snap.body.revision||!Number.isInteger(a.id))throw Error('Confirmación inválida');
  store.db.transaction(()=>{store.ack(id,snap.body.revision);store.set('photos_ack_'+id,snap.photos.map(p=>p.sha));})();
  return a;
 }catch(e){store.attempt(id,String(e.message).slice(0,160));throw e;}
}
module.exports={uploadOne};
