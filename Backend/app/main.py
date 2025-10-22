# app/main.py
from fastapi import FastAPI
from app.db import get_conn

# Routers
from app.routes.stations import router as stations_router
from app.routes.subirphotos import router as subirphotos_router
# (si después agregás más routers, importalos y sumalos acá)

APP_VERSION = "0.1.0"

app = FastAPI(title="Cargadero PIN API", version=APP_VERSION)

# Endpoints base
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/health/db")
def health_db():
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/")
def root():
    return {"app": "Cargadero PIN API", "version": APP_VERSION}

# Registrar routers
app.include_router(stations_router)
app.include_router(subirphotos_router)
