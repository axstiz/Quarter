from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.api.routes import api_router
from src.db.session import engine, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(
    title="PostCode Planner",
    description="Кор картальное планирование команд и звёздная карта. См. README.",
    lifespan=lifespan,
)

app.include_router(api_router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
