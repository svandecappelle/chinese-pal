import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from .db import pool, run_migrations, wait_for_db
from .routers import exercises, reviews, tts, vocab
from .tts import preload

logging.basicConfig(level=logging.INFO)

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    run_migrations()
    pool.open()
    preload()
    yield
    pool.close()


app = FastAPI(title="Révision de vocabulaire chinois", lifespan=lifespan)
app.include_router(vocab.router)
app.include_router(exercises.router)
app.include_router(reviews.router)
app.include_router(tts.router)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    """Le navigateur revalide le frontend à chaque chargement (sinon vieux JS après une mise à jour)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


# Frontend statique servi à la racine (déclaré en dernier pour ne pas masquer /api).
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
