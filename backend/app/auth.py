"""Comptes : mots de passe, sessions par cookie, droits.

Les droits sont portés par les groupes (`groups.permissions`) ; un administrateur les a tous.
Le jeton de session est aléatoire, envoyé dans un cookie HttpOnly, et seule son empreinte
SHA-256 est en base : une fuite de la table ne permet pas d'ouvrir de session.
"""

import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response

from .config import settings
from .db import pool

log = logging.getLogger(__name__)

PERMISSIONS = {
    "manage_vocab": "Ajouter et modifier le vocabulaire",
    "manage_courses": "Créer des exercices et les attribuer",
    "manage_users": "Gérer les comptes et les groupes",
}

COOKIE = "session"
SESSION_DAYS = 30
# Un invité (visiteur qui révise un exercice public) n'a que ce cookie pour retrouver sa
# progression : il dure plus longtemps, et le compte invité disparaît avec lui.
GUEST_SESSION_DAYS = 365

# ---------------------------------------------------------------- mots de passe

# scrypt (bibliothèque standard) : coûteux en mémoire, donc lent à attaquer par force brute.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        computed = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p)
        )
    except ValueError:
        return False
    return hmac.compare_digest(computed.hex(), digest)


# Calculé une fois : vérifier un compte inexistant prend le même temps qu'un vrai, ce qui
# évite de révéler quels identifiants existent.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def generate_password() -> str:
    return secrets.token_urlsafe(12)


# ---------------------------------------------------------------- tentatives de connexion

FAILURES_ALLOWED = 8
FAILURE_WINDOW = 15 * 60
_failures: dict[str, deque] = defaultdict(deque)


def check_throttle(key: str) -> None:
    attempts = _failures[key]
    while attempts and attempts[0] < time.monotonic() - FAILURE_WINDOW:
        attempts.popleft()
    if len(attempts) >= FAILURES_ALLOWED:
        raise HTTPException(429, "Trop de tentatives : réessaie dans quelques minutes")


def record_failure(key: str) -> None:
    _failures[key].append(time.monotonic())


def clear_failures(key: str) -> None:
    _failures.pop(key, None)


# ---------------------------------------------------------------- sessions

def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def open_session(conn, user_id: int, request: Request, response: Response,
                 days: int = SESSION_DAYS) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=days)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (token_hash(token), user_id, expires),
    )
    conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    response.set_cookie(
        COOKIE, token,
        max_age=days * 86400,
        httponly=True,
        samesite="lax",
        # Derrière nginx en HTTPS (X-Forwarded-Proto), le cookie ne part jamais en clair.
        secure=request.url.scheme == "https",
        path="/",
    )


def close_session(conn, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
    response.delete_cookie(COOKIE, path="/")


USER_SQL = """
SELECT u.id, u.username, u.display_name, u.is_admin, u.is_guest,
       COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), '{{}}') AS permissions
FROM users u
LEFT JOIN user_groups ug ON ug.user_id = u.id
LEFT JOIN groups g ON g.id = ug.group_id
LEFT JOIN LATERAL unnest(g.permissions) AS p ON true
WHERE {where}
GROUP BY u.id
"""


def with_permissions(user: dict) -> dict:
    user["permissions"] = sorted(PERMISSIONS) if user["is_admin"] else sorted(user["permissions"])
    return user


def load_user(conn, user_id: int) -> dict | None:
    user = conn.execute(USER_SQL.format(where="u.id = %s AND u.active"), (user_id,)).fetchone()
    return with_permissions(user) if user else None


def visitor(request: Request) -> dict | None:
    """Titulaire de la session : compte, invité (`is_guest`) ou None.

    Prolonge la session au passage (une fois par heure).
    """
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with pool.connection() as conn:
        session = conn.execute(
            """UPDATE sessions s SET last_seen_at = now(),
                   expires_at = CASE WHEN last_seen_at < now() - interval '1 hour'
                       THEN now() + make_interval(days => CASE WHEN u.is_guest THEN %s ELSE %s END)
                       ELSE expires_at END
               FROM users u
               WHERE u.id = s.user_id AND s.token_hash = %s AND s.expires_at > now()
               RETURNING s.user_id""",
            (GUEST_SESSION_DAYS, SESSION_DAYS, token_hash(token)),
        ).fetchone()
        return load_user(conn, session["user_id"]) if session else None


def optional_user(user: dict | None = Depends(visitor)) -> dict | None:
    """L'utilisateur connecté à un vrai compte, ou None (un invité n'est pas connecté)."""
    return None if user is None or user["is_guest"] else user


def create_guest(conn, request: Request, response: Response) -> dict:
    """Compte invité pour un visiteur qui révise un exercice public, tenu par un cookie."""
    # Les invités dont la session a expiré ne peuvent plus être retrouvés : on les efface.
    conn.execute(
        """DELETE FROM users u WHERE u.is_guest
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())
           AND u.created_at < now() - interval '1 day'"""
    )
    guest_id = conn.execute(
        """INSERT INTO users (username, display_name, is_guest, last_login_at)
           VALUES (%s, 'Invité', true, now()) RETURNING id""",
        (f"invite-{secrets.token_hex(8)}",),
    ).fetchone()["id"]
    open_session(conn, guest_id, request, response, GUEST_SESSION_DAYS)
    return load_user(conn, guest_id)


def merge_guest(conn, guest_id: int, user_id: int) -> None:
    """À la connexion, la progression de l'invité rejoint le compte, puis l'invité disparaît.

    Pour une carte déjà révisée des deux côtés, l'état du compte l'emporte.
    """
    conn.execute(
        """INSERT INTO review_states (user_id, word_id, mode, ease, interval_days, repetitions,
                                      lapses, due_at, first_reviewed_at, last_reviewed_at)
           SELECT %s, word_id, mode, ease, interval_days, repetitions, lapses, due_at,
                  first_reviewed_at, last_reviewed_at
           FROM review_states WHERE user_id = %s
           ON CONFLICT (user_id, word_id, mode) DO NOTHING""",
        (user_id, guest_id),
    )
    conn.execute("UPDATE review_log SET user_id = %s WHERE user_id = %s", (user_id, guest_id))
    conn.execute("DELETE FROM users WHERE id = %s AND is_guest", (guest_id,))


def current_user(user: dict | None = Depends(optional_user)) -> dict:
    if user is None:
        raise HTTPException(401, "Connecte-toi pour continuer")
    return user


def can(user: dict | None, permission: str) -> bool:
    return user is not None and permission in user["permissions"]


def require(permission: str):
    """Dépendance FastAPI : l'utilisateur connecté doit avoir ce droit."""
    def check(user: dict = Depends(current_user)) -> dict:
        if not can(user, permission):
            raise HTTPException(403, f"Droit nécessaire : {PERMISSIONS[permission].lower()}")
        return user
    return check


# ---------------------------------------------------------------- premier administrateur

def bootstrap_admin() -> None:
    """Donne un mot de passe au premier administrateur (créé sans par la migration 008).

    Il prend ADMIN_USERNAME et ADMIN_PASSWORD (le .env écrit par make install) ; sans mot de
    passe fourni, il en génère un et l'écrit dans le journal de l'application.
    """
    with pool.connection() as conn:
        admin = conn.execute(
            "SELECT id, username FROM users WHERE is_admin AND password_hash IS NULL ORDER BY id LIMIT 1"
        ).fetchone()
        if admin is None:
            return
        username = settings.admin_username or admin["username"]
        taken = conn.execute(
            "SELECT 1 FROM users WHERE lower(username) = lower(%s) AND id <> %s",
            (username, admin["id"]),
        ).fetchone()
        if taken:
            username = admin["username"]
        password = settings.admin_password or generate_password()
        conn.execute(
            "UPDATE users SET username = %s, password_hash = %s WHERE id = %s",
            (username, hash_password(password), admin["id"]),
        )
    if settings.admin_password:
        log.warning("Compte administrateur « %s » prêt (mot de passe : ADMIN_PASSWORD)", username)
    else:
        log.warning(
            "\n\n    Compte administrateur créé\n    identifiant : %s\n    mot de passe : %s\n"
            "    Change-le après la première connexion (menu du compte).\n",
            username, password,
        )
