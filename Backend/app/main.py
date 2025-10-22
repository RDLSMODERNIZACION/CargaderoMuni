from fastapi import FastAPI, Response
from app.db import get_conn

# Routers
from app.routes.stations import router as stations_router
from app.routes.subirphotos import router as subirphotos_router
# (si después agregás más routers, importalos y sumalos acá)

APP_VERSION = "0.1.0"

app = FastAPI(title="Cargadero PIN API", version=APP_VERSION)

# --- Health checks ---
@app.get("/health", include_in_schema=False)
def health():
    """Verifica que la API esté viva."""
    return {"ok": True}

@app.get("/health/db", include_in_schema=False)
def health_db():
    """Verifica la conexión a la base de datos."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# --- Rutas base ---
@app.get("/", include_in_schema=False)
def root():
    """Endpoint raíz, usado por Render y monitoreo."""
    return {"app": "Cargadero PIN API", "version": APP_VERSION, "status": "running"}

@app.head("/", include_in_schema=False)
def root_head():
    """Render hace HEAD / para health-check, así evitamos 405."""
    return Response(status_code=200)

# --- Registrar routers ---
app.include_router(stations_router)
app.include_router(subirphotos_router)
