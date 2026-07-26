from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routes.analysis import router as analysis_router
from backend.api.routes.auth import router as auth_router
from backend.api.routes.dashboard import router as dashboard_router
from backend.api.routes.health import router as health_router
from backend.api.routes.landcover_map import router as landcover_map_router
from backend.api.routes.municipalities import router as municipalities_router
from backend.api.routes.provenance import router as provenance_router
from backend.config import get_settings
from backend.database import engine

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(
    title="NGLIP API",
    description="Nepal GeoAI Land Intelligence Platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Bbox-West", "X-Bbox-South", "X-Bbox-East", "X-Bbox-North"],
)

app.include_router(analysis_router)
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(health_router)
app.include_router(landcover_map_router)
app.include_router(municipalities_router)
app.include_router(provenance_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
