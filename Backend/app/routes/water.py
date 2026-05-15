# app/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from psycopg.errors import Error as PsyError

from app.db import open_pool, close_pool, ping

# Routers existentes
from app.routes.hik import router as hik_router
from app.routes.water import router as water_router
from app.routes.company import router as company_router

# Router sync de usuarios Hikvision desde company
from app.routes.company_sync import router as company_sync_router

# Router fotos
from app.routes.fotos.media import router as fotos_media_router

# Stations
from app.routes.stations import router as stations_router

# KPI
from app.routes.kpi import router as kpi_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Se abre el pool cuando FastAPI ya tiene loop async activo.
    await open_pool()

    try:
        yield
    finally:
        # Se cierra correctamente al apagar.
        await close_pool()


app = FastAPI(
    title="DIRAC Access & Water API",
    lifespan=lifespan,
)

# CORS amplio para pruebas
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    try:
        db_ok = await ping()
        return {
            "ok": True,
            "db": db_ok,
        }
    except PsyError as e:
        return {
            "ok": False,
            "db": False,
            "error": str(e),
        }
    except Exception as e:
        return {
            "ok": False,
            "db": False,
            "error": str(e),
        }


# Montar routers
app.include_router(hik_router, prefix="/access/hik", tags=["hik"])
app.include_router(water_router, prefix="/water", tags=["water"])
app.include_router(company_router, prefix="/company", tags=["company"])
app.include_router(company_sync_router, prefix="/company", tags=["company"])

# Estaciones
app.include_router(stations_router, tags=["stations"])

# KPI
app.include_router(kpi_router)

# Upload de fotos
# Endpoint: POST /fotos/media/upload
app.include_router(fotos_media_router)
