param([string]$NodeRedUserDir = (Join-Path $env:USERPROFILE '.node-red'))
$ErrorActionPreference = 'Stop'
$major = & node -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 22) { throw 'Se necesita Node.js 22 o posterior. No se modificaron los flujos.' }
$package = Join-Path $PSScriptRoot 'node-red-contrib-cargadero-offline-1.0.0.tgz'
if (!(Test-Path $package)) { throw 'Descomprimí el ZIP completo: falta el paquete .tgz.' }
New-Item -ItemType Directory -Force -Path $NodeRedUserDir | Out-Null
Push-Location $NodeRedUserDir
try {
    & npm.cmd install --save-exact $package
    if ($LASTEXITCODE -ne 0) { throw 'Falló npm install. Conservá el flujo anterior.' }
    & node -e "const path=require('path');const entry=require.resolve('node-red-contrib-cargadero-offline/node.js');const DB=require(require.resolve('better-sqlite3',{paths:[path.dirname(entry)]}));const db=new DB(':memory:');db.exec('CREATE TABLE prueba(id INTEGER)');db.close();console.log('SQLite disponible');"
    if ($LASTEXITCODE -ne 0) { throw 'El módulo SQLite no pudo abrirse. No importes aún el flujo nuevo.' }
} finally { Pop-Location }
Write-Host 'Nodo instalado. Iniciá Node-RED, sustituí la pestaña anterior e importá Cargadero_offline.json.'
