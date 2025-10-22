
# Cargadero · Admin (demo hardcoded)

Frontend de administración **sin endpoints**, con datos hardcodeados.
Hecho con **Next.js 14 + Tailwind**.

## Requisitos
- Node 18+ (LTS) y npm

## Cómo correr
```bash
npm install
npm run dev
# abrir http://localhost:3000
```

## Secciones
- **Despachos**: listado + filtros + detalle (eventos + fotos)
- **Usuarios PIN**: habilitar/inhabilitar, reset de intentos, bloquear 24h (solo en memoria)
- **Sesiones PIN**: auditoría visual
- **Estaciones**: activar/desactivar (solo en memoria)
- **Fotos**: grilla filtrable
- **Reportes**: totales, consumo por usuario y por estación, export CSV

> Todo está armado para luego **conectar endpoints** reemplazando los `seed` por fetch a tu API.
