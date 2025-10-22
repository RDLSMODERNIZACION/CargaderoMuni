# Cargadero Backend (FastAPI)

Backend simple para control de cargadero por m³ con:
- Control de despachos (autorizar/start/tick/stop)
- Evidencia fotográfica (snapshot opcional)
- Recibo PDF con QR y hash
- Recargas vía Mercado Pago (opcional)
- Postgres/Supabase con `psycopg_pool`

## Estructura
```
app/
  main.py
  db.py
  utils.py
  routes/
    health.py
    cargadero.py
    payments_mp.py
requirements.txt
Procfile
render.yaml
sql/schema_cargadero.sql
.env.example
```

## Desarrollo local
1. Crear y activar venv.
2. `pip install -r requirements.txt`
3. Copiar `.env.example` a `.env` y completar variables.
4. `uvicorn app.main:app --reload`
5. Abrir `http://localhost:8000/docs`

## Deploy en Render
1. Subí este repo a GitHub.
2. En Render → **New Web Service** → conectá el repo.
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`
5. Seteá variables de entorno (DB, CORS, etc.).

## SQL
En `sql/schema_cargadero.sql` está el esquema base para Supabase/Postgres.
Ejecutalo en el SQL Editor de Supabase (o en tu DB).
