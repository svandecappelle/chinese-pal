"""Gestion des comptes et des groupes (droit « manage_users »).

Seul un administrateur peut nommer ou modifier un administrateur ; il reste toujours au moins
un administrateur actif, et personne ne peut se retirer ses propres droits par erreur.
"""

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from pydantic import BaseModel, Field

from .. import auth
from ..db import pool

router = APIRouter(prefix="/api/admin", tags=["administration"])

Username = Field(pattern=r"^[a-zA-Z0-9._-]{2,40}$")


class UserIn(BaseModel):
    username: str = Username
    display_name: str = Field("", max_length=80)
    is_admin: bool = False
    active: bool = True
    group_ids: list[int] = []


class NewUserIn(UserIn):
    # Vide : un mot de passe est généré et renvoyé une seule fois.
    password: str = Field("", max_length=200)


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(None, max_length=300)
    permissions: list[str] = []
    member_ids: list[int] = []


USERS_SQL = """
SELECT u.id, u.username, u.display_name, u.is_admin, u.active, u.created_at, u.last_login_at,
       COALESCE(array_agg(ug.group_id ORDER BY ug.group_id)
                FILTER (WHERE ug.group_id IS NOT NULL), '{{}}') AS group_ids
FROM users u LEFT JOIN user_groups ug ON ug.user_id = u.id
{where}
GROUP BY u.id
ORDER BY lower(u.username)
"""

GROUPS_SQL = """
SELECT g.*, COALESCE(array_agg(ug.user_id ORDER BY ug.user_id)
                     FILTER (WHERE ug.user_id IS NOT NULL), '{{}}') AS member_ids
FROM groups g LEFT JOIN user_groups ug ON ug.group_id = g.id
{where}
GROUP BY g.id
ORDER BY g.name
"""


def fetch_user(conn, user_id: int) -> dict:
    user = conn.execute(USERS_SQL.format(where="WHERE u.id = %s"), (user_id,)).fetchone()
    if user is None:
        raise HTTPException(404, "Compte introuvable")
    return user


def fetch_group(conn, group_id: int) -> dict:
    group = conn.execute(GROUPS_SQL.format(where="WHERE g.id = %s"), (group_id,)).fetchone()
    if group is None:
        raise HTTPException(404, "Groupe introuvable")
    return group


def check_permissions(permissions: list[str]) -> list[str]:
    unknown = set(permissions) - set(auth.PERMISSIONS)
    if unknown:
        raise HTTPException(400, f"Droit inconnu : {', '.join(sorted(unknown))}")
    return sorted(set(permissions))


def ensure_an_admin_remains(conn) -> None:
    left = conn.execute("SELECT count(*) AS n FROM users WHERE is_admin AND active").fetchone()["n"]
    if left == 0:
        raise HTTPException(400, "Il doit rester au moins un administrateur actif")


def set_groups(conn, user_id: int, group_ids: list[int]) -> None:
    conn.execute("DELETE FROM user_groups WHERE user_id = %s", (user_id,))
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO user_groups (user_id, group_id) VALUES (%s, %s)",
            [(user_id, g) for g in set(group_ids)],
        )


# ---------------------------------------------------------------- comptes

@router.get("/users")
def list_users(_: dict = Depends(auth.require("manage_users"))):
    with pool.connection() as conn:
        return conn.execute(USERS_SQL.format(where="")).fetchall()


@router.post("/users", status_code=201)
def create_user(data: NewUserIn, me: dict = Depends(auth.require("manage_users"))):
    if data.is_admin and not me["is_admin"]:
        raise HTTPException(403, "Seul un administrateur peut créer un administrateur")
    password = data.password or auth.generate_password()
    if len(password) < 8:
        raise HTTPException(400, "Le mot de passe doit faire au moins 8 caractères")
    try:
        with pool.connection() as conn:
            user_id = conn.execute(
                """INSERT INTO users (username, display_name, password_hash, is_admin, active)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (data.username, data.display_name.strip(), auth.hash_password(password),
                 data.is_admin, data.active),
            ).fetchone()["id"]
            set_groups(conn, user_id, data.group_ids)
            user = fetch_user(conn, user_id)
    except UniqueViolation:
        raise HTTPException(409, "Cet identifiant est déjà pris")
    except ForeignKeyViolation:
        raise HTTPException(400, "Groupe inconnu")
    # Le mot de passe n'est renvoyé que s'il a été généré : il ne sera plus jamais lisible.
    return {**user, "password": None if data.password else password}


@router.put("/users/{user_id}")
def update_user(user_id: int, data: UserIn, me: dict = Depends(auth.require("manage_users"))):
    try:
        with pool.connection() as conn:
            before = fetch_user(conn, user_id)
            if (before["is_admin"] or data.is_admin) and not me["is_admin"]:
                raise HTTPException(403, "Seul un administrateur peut modifier un administrateur")
            if user_id == me["id"] and (not data.active or before["is_admin"] != data.is_admin):
                raise HTTPException(400, "Tu ne peux pas désactiver ton compte ni changer ton propre rôle")
            conn.execute(
                """UPDATE users SET username = %s, display_name = %s, is_admin = %s, active = %s
                   WHERE id = %s""",
                (data.username, data.display_name.strip(), data.is_admin, data.active, user_id),
            )
            set_groups(conn, user_id, data.group_ids)
            ensure_an_admin_remains(conn)
            if not data.active:
                conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
            return fetch_user(conn, user_id)
    except UniqueViolation:
        raise HTTPException(409, "Cet identifiant est déjà pris")
    except ForeignKeyViolation:
        raise HTTPException(400, "Groupe inconnu")


@router.post("/users/{user_id}/password")
def reset_password(user_id: int, me: dict = Depends(auth.require("manage_users"))):
    """Nouveau mot de passe généré, renvoyé une seule fois ; les sessions du compte sont fermées."""
    with pool.connection() as conn:
        user = fetch_user(conn, user_id)
        if user["is_admin"] and not me["is_admin"]:
            raise HTTPException(403, "Seul un administrateur peut modifier un administrateur")
        password = auth.generate_password()
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                     (auth.hash_password(password), user_id))
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return {"password": password}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, me: dict = Depends(auth.require("manage_users"))):
    if user_id == me["id"]:
        raise HTTPException(400, "Tu ne peux pas supprimer ton propre compte")
    with pool.connection() as conn:
        user = fetch_user(conn, user_id)
        if user["is_admin"] and not me["is_admin"]:
            raise HTTPException(403, "Seul un administrateur peut supprimer un administrateur")
        # Sa progression part avec lui ; ses cours restent, sans auteur.
        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))
        ensure_an_admin_remains(conn)


# ---------------------------------------------------------------- groupes

@router.get("/groups")
def list_groups(user: dict = Depends(auth.current_user)):
    """Lisible aussi par les professeurs, qui attribuent leurs cours aux groupes."""
    if not (auth.can(user, "manage_users") or auth.can(user, "manage_courses")):
        raise HTTPException(403, "Droit nécessaire : gérer les comptes ou créer des exercices")
    with pool.connection() as conn:
        return conn.execute(GROUPS_SQL.format(where="")).fetchall()


def save_group(conn, group_id: int, data: GroupIn) -> dict:
    conn.execute("DELETE FROM user_groups WHERE group_id = %s", (group_id,))
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO user_groups (user_id, group_id) VALUES (%s, %s)",
            [(u, group_id) for u in set(data.member_ids)],
        )
    return fetch_group(conn, group_id)


@router.post("/groups", status_code=201)
def create_group(data: GroupIn, _: dict = Depends(auth.require("manage_users"))):
    try:
        with pool.connection() as conn:
            group_id = conn.execute(
                "INSERT INTO groups (name, description, permissions) VALUES (%s, %s, %s) RETURNING id",
                (data.name.strip(), data.description, check_permissions(data.permissions)),
            ).fetchone()["id"]
            return save_group(conn, group_id, data)
    except UniqueViolation:
        raise HTTPException(409, "Un groupe porte déjà ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Compte inconnu")


@router.put("/groups/{group_id}")
def update_group(group_id: int, data: GroupIn, _: dict = Depends(auth.require("manage_users"))):
    try:
        with pool.connection() as conn:
            fetch_group(conn, group_id)
            conn.execute(
                "UPDATE groups SET name = %s, description = %s, permissions = %s WHERE id = %s",
                (data.name.strip(), data.description, check_permissions(data.permissions), group_id),
            )
            return save_group(conn, group_id, data)
    except UniqueViolation:
        raise HTTPException(409, "Un groupe porte déjà ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Compte inconnu")


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, _: dict = Depends(auth.require("manage_users"))):
    with pool.connection() as conn:
        if conn.execute("DELETE FROM groups WHERE id = %s", (group_id,)).rowcount == 0:
            raise HTTPException(404, "Groupe introuvable")
