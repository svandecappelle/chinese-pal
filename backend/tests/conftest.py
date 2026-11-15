"""Tests de l'API : l'application tourne dans le processus (TestClient) sur une base jetable.

La base (TEST_DATABASE_URL, son nom doit finir par « _test ») est supprimée puis recréée à chaque
lancement : migrations, administrateur (ADMIN_USERNAME / ADMIN_PASSWORD), listes HSK 1 à 3 importées.
Les tests partagent cette base : chacun crée ses propres comptes et exercices.

Lancement : `make test` (conteneur, avec PostgreSQL de compose).
"""

import os
import secrets
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://chinese:chinese@localhost:5432/chinese_test")
ADMIN_USERNAME = os.environ.setdefault("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.setdefault("ADMIN_PASSWORD", "admin-de-test")


def recreate_database(url: str) -> None:
    parts = urlsplit(url)
    name = parts.path.lstrip("/")
    if not name.endswith("_test"):
        raise RuntimeError(f"Base de test refusée : « {name} » (le nom doit finir par _test)")
    maintenance = urlunsplit(parts._replace(path="/postgres"))
    with psycopg.connect(maintenance, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')


# Avant d'importer l'application : elle lit DATABASE_URL à l'import (app.config).
recreate_database(TEST_DATABASE_URL)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from fastapi.testclient import TestClient  # noqa: E402

from app.db import pool  # noqa: E402
from app.main import app  # noqa: E402


class Client:
    """Un navigateur : ses propres cookies (session). `call` renvoie (statut, JSON ou None)."""

    def __init__(self):
        self.http = TestClient(app)

    def call(self, method: str, path: str, body=None):
        response = self.http.request(method, "/api" + path, json=body)
        return response.status_code, (response.json() if response.content else None)

    def login(self, username: str, password: str) -> "Client":
        status, _ = self.call("POST", "/account/login", {"username": username, "password": password})
        assert status == 200, f"connexion de {username} : {status}"
        return self


@pytest.fixture(scope="session", autouse=True)
def running_app():
    """Démarre l'application une fois (migrations, administrateur, données) pour toute la session."""
    with TestClient(app):
        admin = Client().login(ADMIN_USERNAME, ADMIN_PASSWORD)
        for pack in ("hsk1", "hsk2", "hsk3"):
            status, _ = admin.call("POST", f"/packs/{pack}/import")
            assert status == 200, f"import {pack} : {status}"
        yield


@pytest.fixture
def anon():
    return Client()


@pytest.fixture
def admin():
    return Client().login(ADMIN_USERNAME, ADMIN_PASSWORD)


@pytest.fixture
def make_user(admin):
    """Crée un compte (noms uniques) et renvoie (client connecté, compte) ; supprimés à la fin."""
    created = []

    def make(prefix="eleve", groups=(), display_name=None):
        username = f"{prefix}-{secrets.token_hex(3)}"
        body = {"username": username, "group_ids": list(groups)}
        if display_name:
            body["display_name"] = display_name
        status, user = admin.call("POST", "/admin/users", body)
        assert status == 201
        created.append(user["id"])
        return Client().login(username, user["password"]), user

    yield make
    for user_id in created:
        admin.call("DELETE", f"/admin/users/{user_id}")


@pytest.fixture
def groups(admin):
    """Groupes créés par les migrations : {nom: id}."""
    return {g["name"]: g["id"] for g in admin.call("GET", "/admin/groups")[1]}


@pytest.fixture
def sql():
    """Requête directe sur la base de test, validée aussitôt (pour simuler le temps qui passe)."""
    def run(query: str, params=None):
        with pool.connection() as conn:
            cursor = conn.execute(query, params)
            return cursor.fetchall() if cursor.description else None
    return run
