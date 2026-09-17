from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import api_router
from src.api.crud import router as crud_router
from src.core.config import settings
from src.db.session import engine, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(
    title="PostCode Planner",
    description="Квартальное планирование команд и звёздная карта. См. README.",
    lifespan=lifespan,
)

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,  # сочетание "*" + credentials запрещено спецификацией CORS
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(crud_router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
