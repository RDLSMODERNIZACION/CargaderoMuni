#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/node-v22.23.3-linux-arm64/bin:$PATH"
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
user_dir="${1:-/root/node-red-prueba22}"
backend="${2:-https://cargaderomuni.onrender.com}"
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
node - "$backend" <<'JS'
(async()=>{const res=await fetch(process.argv[2]+'/openapi.json',{signal:AbortSignal.timeout(30000)});if(!res.ok)throw Error('No se pudo verificar el backend');const api=await res.json();if(!api.paths?.['/water/dispatch/{dispatch_id}/convert-time'])throw Error('Esperá el despliegue del backend antes de actualizar la IoT');})().catch(e=>{console.error(e.message);process.exit(1)});
JS
was_active=0
if systemctl is-active --quiet node-red; then was_active=1; fi
restore_service() { if (( was_active )); then systemctl start node-red; fi; }
trap restore_service EXIT
systemctl stop node-red
cd "$user_dir"
node <<'JS'
const fs=require('fs'),path=require('path');
const entry=require.resolve('node-red-contrib-cargadero-offline/node.js');
const DB=require(require.resolve('better-sqlite3',{paths:[path.dirname(entry)]}));
const flows=JSON.parse(fs.readFileSync('flows.json','utf8'));
for(const n of flows.filter(n=>n.type==='cargadero-offline')){
 const dir=n.directory?path.resolve(n.directory):path.join(process.cwd(),'cargadero-offline','station-'+(n.station||'2'));
 const file=path.join(dir,'cargas.sqlite');if(!fs.existsSync(file))continue;
 const db=new DB(file,{readonly:true});const active=db.prepare("SELECT v FROM kv WHERE k='active'").get();db.close();
 if(active&&JSON.parse(active.v)){console.error('Hay una carga abierta. Cerrala antes de actualizar.');process.exit(1);}
}
JS
backup_dir="/root/respaldo-cargadero-tiempos-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
tar --exclude='./node_modules' -czf "$backup_dir/datos-y-flujo.tar.gz" -C "$user_dir" .
npm install --save-exact "$package_dir/node-red-contrib-cargadero-offline-1.1.0.tgz"
node -e "const p=require('node-red-contrib-cargadero-offline/package.json');if(p.version!=='1.1.0')process.exit(1);console.log('Nodo de horarios instalado:',p.version)"
printf 'Respaldo: %s\n' "$backup_dir"
echo 'No hace falta importar otro flujo. Se conservan las IP, contraseñas y datos locales.'
