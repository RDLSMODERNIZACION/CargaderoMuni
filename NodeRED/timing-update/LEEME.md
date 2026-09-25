# Cargadero: registro de horarios

El nodo 1.1.0 conserva el flujo actual y sus conexiones. Las nuevas cargas envían inicio real de bomba y fin, además de la identidad y las fotos. No envían litros ni caudal. Los datos quedan guardados en SQLite y se reenvían al volver internet.

En la app: Despachos → ⋮ → Convertir tiempo a litros. Ingresar el caudal verificado en L/min y guardar. La app muestra una estimación: duración en minutos × caudal. No es una medición de caudalímetro. Los horarios no se cambian. Una desconexión del PLC o reinicio durante la carga bloquea la conversión automática hasta revisar el registro. La validación RFID conserva su hora original, distinta del arranque de bomba.

Los registros anteriores conservan sus litros. La conversión se ofrece únicamente para nuevas cargas con inicio y fin de bomba. Las cargas sin inicio o sin fin quedan pendientes. Una foto tardía no sobrescribe una conversión guardada.

## Instalar en la IoT 192.168.1.33

Esperar a que termine el despliegue del backend y a que no haya una carga abierta. Copiar este ZIP a /root de la IoT y ejecutar:

```bash
python3 -m zipfile -e /root/Cargadero_actualizacion_tiempos.zip /root/Cargadero_actualizacion_tiempos
bash /root/Cargadero_actualizacion_tiempos/actualizar-iot.sh /root/node-red-prueba22
systemctl is-active node-red
journalctl -u node-red -n 30 --no-pager
```

El script verifica el backend, detiene el servicio, comprueba que no haya una carga local abierta, respalda los datos y actualiza solamente el módulo. Reinicia el servicio si estaba activo. No importar nuevamente el flujo. No borrar cargas.sqlite ni la carpeta photos.

## Prueba

Iniciar y terminar una carga corta. En Despachos deben verse los horarios y volumen pendiente. Abrir la conversión, indicar el caudal real verificado y guardar. Por ejemplo, 60 segundos a 600 L/min equivalen a 600 litros estimados; no asumir ese caudal sin verificarlo en campo.
