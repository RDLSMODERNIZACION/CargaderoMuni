# app/main.py

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from psycopg.errors import Error as PsyError

from app.db import close_pool, open_pool, ping
from app.routes import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Abre el pool de conexiones al iniciar FastAPI
    y lo cierra correctamente al apagar.
    """

    await open_pool()

    try:
        yield
    finally:
        await close_pool()


app = FastAPI(
    title="DIRAC Access & Water API",
    lifespan=lifespan,
)


# CORS amplio para la etapa de pruebas
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """
    Comprueba el funcionamiento de la API
    y la conexión con Supabase/PostgreSQL.
    """

    try:
        db_ok = await ping()

        return {
            "ok": True,
            "db": db_ok,
        }

    except PsyError as error:
        return {
            "ok": False,
            "db": False,
            "error": str(error),
        }

    except Exception as error:
        return {
            "ok": False,
            "db": False,
            "error": str(error),
        }


# Todas las rutas se registran desde app/routes/__init__.py
app.include_router(api_router)