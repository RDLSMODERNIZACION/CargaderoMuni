#!/usr/bin/env bash
set -euo pipefail
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
user_dir="${1:-$HOME/.node-red}"
major="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( major < 22 )); then echo 'Se necesita Node.js 22 o posterior; conservá el flujo anterior.' >&2; exit 1; fi
mkdir -p "$user_dir"
cd "$user_dir"
npm install --save-exact "$package_dir/node-red-contrib-cargadero-offline-1.0.0.tgz"
node -e "const path=require('path');const entry=require.resolve('node-red-contrib-cargadero-offline/node.js');const DB=require(require.resolve('better-sqlite3',{paths:[path.dirname(entry)]}));const db=new DB(':memory:');db.exec('CREATE TABLE prueba(id INTEGER)');db.close();console.log('SQLite disponible');"
echo 'Nodo instalado. Reiniciá Node-RED e importá Cargadero_offline.json sustituyendo la pestaña anterior.'
