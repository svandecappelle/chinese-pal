import logging
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=False,
)


def wait_for_db() -> None:
    """Attend que PostgreSQL accepte les connexions (utile au premier démarrage)."""
    for attempt in range(1, settings.db_connect_retries + 1):
        try:
            with psycopg.connect(settings.database_url, connect_timeout=3):
                return
        except psycopg.OperationalError:
            log.info("DB indisponible (tentative %d), nouvel essai...", attempt)
            time.sleep(1)
    raise RuntimeError("Impossible de se connecter à PostgreSQL")


def run_migrations() -> None:
    """Applique dans l'ordre les fichiers migrations/NNN_*.sql non encore appliqués."""
    with psycopg.connect(settings.database_url, autocommit=False) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                   version TEXT PRIMARY KEY,
                   applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
               )"""
        )
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.stem in applied:
                continue
            log.info("Migration %s", path.name)
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (path.stem,))
        conn.commit()
