# Cargadero: registro local y recuperación de internet

Esta actualización requiere instalar un nodo local, además de importar el JSON. No basta con importar el flujo: el nodo guarda las cargas en SQLite y los archivos de fotos en la máquina que ejecuta Node-RED. Requiere Node.js 22 o posterior. La instalación inicial necesita internet; el registro de cargas luego funciona sin internet.

## Configuración conservada

Estación 2; PLC 192.168.1.22; teclado 192.168.1.25; cámaras 192.168.1.26 y 192.168.1.27. El conteo recibe `Bomba / I0.2`, como en el archivo original. `Q0.0 / CONTAR LITROS` estaba sin cable y se conserva así. PLC y cargas activos. El caudal se estima en 600 L/min; puede cambiarse en el nodo «Cargas · SQLite y reenvío». NO es una lectura de totalizador ni un caudal medido.

## Instalación en Windows

1. Exportar un respaldo de todos los flujos. Realizar el cambio con la bomba detenida y sin despacho activo.
2. Descomprimir todo el ZIP en una carpeta. Verificar `node -v` (22 o posterior).
3. Detener Node-RED con Ctrl+C en su consola. En PowerShell, dentro de la carpeta descomprimida:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-windows.ps1
```

El instalador agrega el nodo en `$env:USERPROFILE\.node-red`. Si Node-RED usa otro `--userDir` o funciona con otra cuenta/servicio, pasar la carpeta real:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-windows.ps1 -NodeRedUserDir "C:\ruta\real\.node-red"
```

4. Iniciar Node-RED usando la cuenta y carpeta habituales. Conservar las variables o credenciales Digest del teclado y cámaras.
5. Deshabilitar la pestaña anterior e importar `Cargadero_offline.json`. No ejecutar dos sincronizadores ni dos registros locales para la misma estación. Revisar las IP y las credenciales de los nodos HTTP Digest. Deploy.

## Instalación en IOT2050 / Linux

Copiar y descomprimir el paquete en el IOT. Ejecutar con el usuario que corre Node-RED. En la instalación root usada anteriormente, el directorio es `/root/.node-red`.

```bash
node -v
systemctl stop node-red
bash instalar-linux.sh /root/.node-red
systemctl start node-red
```

Se requiere Node.js 22 o posterior y CPU/plataforma con binario compatible de better-sqlite3. El instalador prueba la apertura de SQLite antes de finalizar. Si falla, no importar aún el flujo nuevo; reiniciar el servicio anterior mientras se resuelve la instalación.

## Uso y confirmación

El backend debe tener desplegada esta revisión y las columnas de `Backend/sql/20260924_offline_dispatch.sql` (ya aplicadas en la base durante la implementación). No se requiere HIK_SYNC_TOKEN, conforme a la configuración solicitada; se mantiene Digest del teclado/cámaras.

- Al iniciar una carga: se genera un UUID y se escribe en SQLite ANTES de pedir fotos o contactar al backend.
- Con cada muestra de bomba: se guarda el tiempo observado y los litros estimados. Cuando se observa OFF tras haber observado ON, se cierra localmente.
- Cada imagen recibida se guarda inmediatamente en disco, con sincronización a disco antes de agregarla al registro SQLite. Una cámara fallida no impide registrar la carga.
- Los pendientes se reintentan automáticamente. El servidor confirma UUID y revisión. Una respuesta perdida o un reintento no crea otro despacho.
- El servidor conserva la fecha original, el fin, litros, empresa y camionero resolubles. Una credencial revocada o una empresa no habilitada al reenviar no elimina la evidencia: la carga queda marcada REVISAR. No se habilita un relé desde este endpoint.
- Las fotos ya confirmadas no se vuelven a transmitir con cada actualización de litros. Fotos tardías generan una nueva revisión del mismo despacho.
- Las cargas y fotos no se borran automáticamente, ni siquiera después de sincronizar. Monitorizar espacio y hacer respaldo periódico con Node-RED detenido; copiar toda la carpeta (incluido SQLite y sus archivos auxiliares).
- El padrón se guarda sin PIN/contraseñas en SQLite y no se borra al fallar internet. Tras 72 horas sin actualizarse deja de considerarse vigente: los accesos aceptados por el teclado se siguen registrando y se marcan para revisión. El equipo conserva sus propias tarjetas/permisos; este nodo no controla la aceptación física.
- Sin padrón o con identidad desconocida también se guarda la evidencia de un evento aceptado o un arranque manual; nunca se atribuye a otro camionero por defecto.
- Un reinicio conserva la carga abierta y la retoma al volver a recibir muestras. Los intervalos sin muestras mayores a 5 s o con reloj atrasado no se contabilizan como agua: quedan señalados para revisión. Si no se observa arranque durante 120 s, la carga queda cerrada en cero con marca `sin_arranque_observado`.

## Dónde se guarda

Por defecto: `<userDir de Node-RED>/cargadero-offline/station-2/`.

- `cargas.sqlite` y auxiliares: cargas, revisiones, padrón y confirmaciones.
- `photos/`: imágenes originales.

No usar una carpeta temporal ni una unidad de red. Puede configurarse una ruta absoluta en el nodo local. Una carpeta corresponde a una sola estación; una sola instancia debe escribir en ella. Para cambiar de estación, cambiar tanto CONFIG central como la estación del nodo local y usar su carpeta correspondiente. No cambiar de carpeta mientras existan pendientes.

## Prueba en campo

1. Con internet: sincronizar usuarios. Debug debe mostrar `PADRON_GUARDADO`.
2. Cortar SOLO la salida a internet, conservando la red local con PLC, teclado y cámaras.
3. Realizar una carga controlada. Comprobar litros locales y el contador de pendientes; al parar la bomba, el registro queda cerrado.
4. Restaurar internet. Esperar `CARGA_CONFIRMADA_SERVIDOR`. Verificar en la app un único despacho, hora original, litros y fotos. El botón «Ver pendientes locales» debe terminar en cero.
5. Repetir un reintento y verificar que no hay un segundo despacho.

La implementación pasó pruebas automatizadas de pérdida de respuesta, reinicio, fotos, cambio de litros durante envío, fallos de disco, padrón vencido y eliminación de duplicados. La instalación y prueba física en tu PC/IOT siguen pendientes. Esto cubre cortes de internet, no garantiza contabilizar agua mientras PLC/Node-RED no reciben energía. Para esa garantía hace falta respaldo eléctrico o totalizador persistente en el PLC.

## Desarrollo

`npm ci && npm test` en esta carpeta. Backend: `PYTHONPATH=Backend pytest -q Backend/tests`.
La base conserva RLS sin modificaciones de permisos. Los avisos existentes de Supabase sobre funciones y políticas no se modifican con este cambio; referencia: https://supabase.com/docs/guides/database/database-linter.

## Versión 1.1.0: horarios y conversión en la app
Las nuevas cargas usan `meter_method: timestamps`, conservan `started_at` para el evento de acceso, agregan `pump_started_at` al primer estado de bomba encendida y cierran con `ended_at`. El envío omite `liters` y `flow_l_min`; estos valores se asignan desde el detalle del despacho en la app. No se modifica el flujo ni las IP. Actualizar con el paquete de `NodeRED/timing-update`. Los registros anteriores mantienen su contrato `time_estimate` para poder reenviarse sin cambiar su UUID/revisión. Las interrupciones se marcan para revisión y no se convierten automáticamente.
