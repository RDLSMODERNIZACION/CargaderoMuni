import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from psycopg.errors import Error as PsyError

# Routers existentes
from app.routes.hik import router as hik_router
from app.routes.water import router as water_router
from app.routes.company import router as company_router

# Nuevo router (sync de usuarios Hikvision desde company)
from app.routes.company_sync import router as company_sync_router  # <- NUEVO

# ✅ NUEVO: router de fotos (upload a Supabase Storage)
from app.routes.fotos.media import router as fotos_media_router  # <- NUEVO

app = FastAPI(title="DIRAC Access & Water API")

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
    # ping simple a DB
    try:
        from app.db import pool
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1")
                row = await cur.fetchone()
                return {"ok": True, "db": (row and row[0] == 1)}
    except PsyError as e:
        return {"ok": False, "db": False, "error": str(e)}

# Montar routers
app.include_router(hik_router, prefix="/access/hik", tags=["hik"])
app.include_router(water_router, prefix="/water", tags=["water"])
app.include_router(company_router, prefix="/company", tags=["company"])
app.include_router(company_sync_router, prefix="/company", tags=["company"])  # <- NUEVO

# ✅ NUEVO: upload de fotos
# Endpoint: POST /fotos/media/upload
app.include_router(fotos_media_router)
