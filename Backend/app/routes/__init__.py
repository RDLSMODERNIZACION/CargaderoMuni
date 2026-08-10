from fastapi import APIRouter

from app.routes.company import router as company_router
from app.routes.company_sync import router as company_sync_router
from app.routes.fotos.media import router as fotos_media_router
from app.routes.hik import router as hik_router
from app.routes.kpi import router as kpi_router
from app.routes.stations import router as stations_router
from app.routes.wallet import router as wallet_router
from app.routes.water import router as water_router


api_router = APIRouter()


# Control de acceso Hikvision
api_router.include_router(
    hik_router,
    prefix="/access/hik",
    tags=["hik"],
)


# Despachos de agua
api_router.include_router(
    water_router,
    prefix="/water",
    tags=["water"],
)


# Administración de empresas
api_router.include_router(
    company_router,
    prefix="/company",
    tags=["company"],
)


# Sincronización de empresas con Hikvision
api_router.include_router(
    company_sync_router,
    prefix="/company",
    tags=["company"],
)


# Billeteras, saldo y movimientos
api_router.include_router(
    wallet_router,
    prefix="/wallet",
    tags=["wallet"],
)


# Estaciones
# stations.py ya define su propia ruta /stations
api_router.include_router(
    stations_router,
)


# Indicadores
# kpi.py ya define su propio prefijo /kpi
api_router.include_router(
    kpi_router,
)


# Fotografías
# media.py ya define su propio prefijo
api_router.include_router(
    fotos_media_router,
)


__all__ = [
    "api_router",
]