import hashlib
import json
import logging
from contextlib import asynccontextmanager
from functools import cache
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import settings

from .db import pool, run_migrations, wait_for_db
from . import auth, ime
from . import tts as speech
from .routers import account, admin, exercises, ime as ime_router, reviews, stats, tts, vocab

logging.basicConfig(level=logging.INFO)

STATIC_DIR = Path(__file__).parent / "static"
SW_TEMPLATE = Path(__file__).parent / "pwa" / "sw.js"
STROKES_DIR = Path(settings.strokes_dir)
HANZI_WRITER = STROKES_DIR / "hanzi-writer.min.js"


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    run_migrations()
    pool.open()
    auth.bootstrap_admin()
    speech.preload()
    ime.preload()
    yield
    pool.close()


app = FastAPI(title="Révision de vocabulaire chinois", lifespan=lifespan)
app.include_router(account.router)
app.include_router(admin.router)
app.include_router(vocab.router)
app.include_router(exercises.router)
app.include_router(reviews.router)
app.include_router(stats.router)
app.include_router(tts.router)
app.include_router(ime_router.router)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    """Le navigateur revalide le frontend à chaque chargement (sinon vieux JS après une mise à jour).
    Les tracés des caractères ne changent jamais : gardés un an."""
    response = await call_next(request)
    if request.url.path.startswith("/strokes/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@cache
def service_worker() -> str:
    """Le service worker avec la liste du frontend à mettre en cache et sa version (empreinte des
    fichiers) : un nouveau déploiement du frontend remplace le cache des téléphones."""
    files = sorted(p for p in STATIC_DIR.rglob("*") if p.is_file())
    precache = ["./"] + [p.relative_to(STATIC_DIR).as_posix() for p in files if p.name != "index.html"]
    digest = hashlib.sha256()
    for path in files + [SW_TEMPLATE] + ([HANZI_WRITER] if HANZI_WRITER.is_file() else []):
        digest.update(path.as_posix().encode())
        digest.update(path.read_bytes())
    if HANZI_WRITER.is_file():
        precache.append("vendor/hanzi-writer.min.js")
    return (SW_TEMPLATE.read_text(encoding="utf-8")
            .replace("__VERSION__", digest.hexdigest()[:12])
            .replace("__PRECACHE__", json.dumps(precache, ensure_ascii=False)))


@app.get("/sw.js", include_in_schema=False)
def sw_js():
    return Response(service_worker(), media_type="text/javascript",
                    headers={"Service-Worker-Allowed": "/"})


@app.get("/vendor/hanzi-writer.min.js", include_in_schema=False)
def hanzi_writer():
    return FileResponse(HANZI_WRITER, media_type="text/javascript")


@app.get("/api/health")
def health():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


# Tracés des caractères (hanzi-writer-data), un fichier JSON par caractère.
if (STROKES_DIR / "data").is_dir():
    app.mount("/strokes", StaticFiles(directory=STROKES_DIR / "data"), name="strokes")

# Frontend statique servi à la racine (déclaré en dernier pour ne pas masquer /api).
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
