# Camioneros RFID · Cargadero

Actualización para DS-K1T502DBFWX-C mediante ISAPI. Usa las tablas existentes `pin_user`, `access_credential`, `company`, `station` y `water_dispatch`; no requiere migración. La comunicación física con el equipo debe validarse en campo: las pruebas incluidas simulan sus respuestas ISAPI.

## Configuración

1. Desplegar el backend de esta revisión. En Render, agregar `HIK_SYNC_TOKEN` con un secreto aleatorio de al menos 32 bytes. Es un token nuevo compartido con Node-RED, no una clave Supabase ni la contraseña del teclado. El endpoint anterior sin `version=2` conserva su comportamiento.
2. En PowerShell, antes de iniciar Node-RED, definir:

```powershell
$env:HIK_IP = "IP_REAL_DEL_TECLADO"
$env:HIK_USER = "admin"
$secret = Read-Host "Contraseña del teclado" -AsSecureString
$env:HIK_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
$secret = Read-Host "HIK_SYNC_TOKEN (el mismo de Render)" -AsSecureString
$env:HIK_SYNC_TOKEN = [System.Net.NetworkCredential]::new("", $secret).Password
node-red.cmd
```

Estas variables duran lo que dure esa sesión. Si Node-RED ya está corriendo, detenerlo con Ctrl+C antes de iniciarlo con las variables. Mantener la consola abierta.

3. Exportar una copia del flujo anterior. Deshabilitar la pestaña anterior y sustituirla por `Cargadero_RFID_camioneros.json`; evitar dos pestañas que reciban `/hik/raw`. No ejecutar simultáneamente el sincronizador anterior en la PC o en el IOT2050: borraría las tarjetas que acaba de crear este flujo.
4. En **CONFIG central**, comprobar `station_id: "3"` (PRUEBA), IP y cámaras. La IP del teclado debe ser distinta de la PC. El valor original `192.168.1.5` también aparecía como IP Ethernet de la PC: verificarlo antes de probar. La estación en la base no guarda actualmente la IP del equipo.
5. El JSON referencia `${HIK_USER}` y `${HIK_PASSWORD}` en los dos nodos HTTP Digest. Revisar sus credenciales tras importar; las credenciales guardadas de la instalación anterior pueden prevalecer. Configurar el usuario y la contraseña recuperada en ambos nodos si fuera necesario.
6. Deploy y pulsar **Sincronizar**. Revisar **RFID · resultado sin credenciales** y **RFID · error**. Una respuesta antigua, HTTP fallido o inventario incompleto no modifica el teclado. Un 503 pide configurar el token en Render; 401 indica token diferente; 404 puede indicar backend sin desplegar o estación no habilitada.
7. Configurar la notificación del teclado hacia `http://IP_DE_ESTA_PC:1880/hik/raw` y permitir Node-RED en la red privada de Windows. Pasar la tarjeta: debe aparecer `DRIVER-2`, empresa `3`, método `rfid` en Debug para el registro actual de Victor. No se publica el número de tarjeta ni el PIN en Debug.
8. `test_mode: true` permite altas, cambios y bajas en el teclado, pero no inicia despachos ni envía telemetría/health. Cuando la prueba sea correcta, cambiar a `false` y Deploy. El flujo conserva los bloques existentes de bomba, litros, fotos y tanque; sus parámetros siguen siendo los del archivo original.

## Comportamiento

- Inventario completo por estación: credenciales con `station_id=NULL` aplican a cualquier estación activa; las específicas solo a la estación indicada. Incluye usuarios inactivos para retirar acceso, sin heredarles el PIN de la empresa.
- Empresas conservan su PIN y su código. Camioneros usan `device_employee_no` (por ejemplo `DRIVER-2`), y una o varias tarjetas activas y vigentes. Un usuario sin empresa activa queda caducado.
- Se conserva la cadena de la tarjeta, incluidos ceros iniciales; no se convierte entre decimal y hexadecimal. Debe coincidir con lo que reporta el teclado.
- Dos pasos: primero caducar usuarios y retirar tarjetas obsoletas; después agregar las faltantes, verificar y habilitar. Permite reasignar una tarjeta entre camioneros sin recrear personas.
- Usuarios numéricos o `DRIVER-n` ausentes del inventario quedan caducados. Otros identificadores manuales no se modifican. En esta versión la limpieza caduca, no elimina usuarios; no borra huellas ni rostros.
- Una actualización fallida se informa y no se marca como exitosa. Puede dejar usuarios temporalmente caducados hasta el siguiente ciclo correcto. Una sincronización automática ocurre cada cinco minutos, además del botón manual.
- Se aceptan accesos de tarjeta con major=5 y sub=1, o sub=75 con modo tarjeta; PIN de empresa con sub=181 y modo contraseña. Si el firmware informa otros códigos, revisar el evento real antes de ampliarlos. No aceptar todos los eventos indiscriminadamente.
- Inventario local de identidad válido por 10 minutos; backend vuelve a validar tarjeta, vigencia, estación, persona y empresa al iniciar el despacho RFID. Se guarda `pin_user_id` y `access_method='rfid'` y se muestra el camionero en listado/detalle.
- PIN de empresa y arranque manual mantienen compatibilidad. El webhook remoto `/access/hik/webhook` no es la ruta de este flujo: los eventos del dispositivo van a Node-RED `/hik/raw`.

## Verificación de desarrollo

```bash
PYTHONPATH=Backend pytest -q Backend/tests
node NodeRED/rfid/test.cjs
cd Frontend
npx tsc --noEmit
```

Los tests no escriben datos en Supabase ni en el teclado. La prueba física pendiente verifica compatibilidad ISAPI, el número de tarjeta leído y los eventos emitidos por el firmware.
