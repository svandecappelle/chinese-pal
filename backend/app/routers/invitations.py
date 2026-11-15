"""Liens d'invitation : la personne invitée crée elle-même son compte.

Un professeur (« manage_courses ») ou un gestionnaire de comptes (« manage_users ») crée un lien
qui fait rejoindre des groupes. Un professeur ne peut inviter que dans des groupes sans droits
(des classes) : une invitation ne donne jamais plus que réviser. Un lien expire, peut être limité
en nombre d'inscriptions, et se révoque en le supprimant.
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from .. import auth
from ..db import pool
from .admin import Username, set_groups

router = APIRouter(prefix="/api/invitations", tags=["invitations"])

INVALID = "Ce lien d'invitation n'est plus valable : demande-en un nouveau à ton professeur."


class InvitationIn(BaseModel):
    note: str = Field("", max_length=120)
    group_ids: list[int] = Field([], max_length=50)
    days: int = Field(14, ge=1, le=90)
    max_uses: int | None = Field(None, ge=1, le=1000)


class SignupIn(BaseModel):
    username: str = Username
    display_name: str = Field("", max_length=80)
    password: str = Field(min_length=8, max_length=200)


def can_invite(user: dict) -> bool:
    return auth.can(user, "manage_users") or auth.can(user, "manage_courses")


def inviter(user: dict = Depends(auth.current_user)) -> dict:
    if not can_invite(user):
        raise HTTPException(403, "Droit nécessaire : gérer les comptes ou créer des exercices")
    return user


def allowed_groups(conn, user: dict, group_ids: list[int]) -> list[int]:
    """Les groupes demandés, s'ils existent et que l'auteur peut y inviter."""
    ids = sorted(set(group_ids))
    rows = conn.execute("SELECT id, name, permissions FROM groups WHERE id = ANY(%s)", (ids,)).fetchall()
    if len(rows) != len(ids):
        raise HTTPException(400, "Groupe inconnu")
    if not auth.can(user, "manage_users"):
        privileged = [r["name"] for r in rows if r["permissions"]]
        if privileged:
            raise HTTPException(403, f"Seul un gestionnaire de comptes peut inviter dans : {', '.join(privileged)}")
    return ids


LIST_SQL = """
SELECT i.id, i.token, i.note, i.group_ids, i.max_uses, i.uses, i.expires_at, i.created_at,
       i.created_by, COALESCE(NULLIF(c.display_name, ''), c.username) AS created_by_name,
       i.expires_at > now() AND (i.max_uses IS NULL OR i.uses < i.max_uses) AS valid,
       COALESCE((SELECT array_agg(g.name ORDER BY g.name) FROM groups g WHERE g.id = ANY(i.group_ids)),
                '{{}}') AS group_names,
       COALESCE((SELECT json_agg(json_build_object('id', u.id, 'username', u.username,
                                                   'display_name', u.display_name) ORDER BY u.created_at)
                 FROM users u WHERE u.invitation_id = i.id), '[]') AS accounts
FROM invitations i LEFT JOIN users c ON c.id = i.created_by
{where}
ORDER BY i.created_at DESC
"""


def visible(user: dict) -> tuple[str, tuple]:
    """Un gestionnaire de comptes voit toutes les invitations ; un professeur, les siennes."""
    if auth.can(user, "manage_users"):
        return "", ()
    return "WHERE i.created_by = %s", (user["id"],)


@router.get("")
def list_invitations(user: dict = Depends(inviter)):
    where, params = visible(user)
    with pool.connection() as conn:
        return conn.execute(LIST_SQL.format(where=where), params).fetchall()


@router.post("", status_code=201)
def create_invitation(data: InvitationIn, user: dict = Depends(inviter)):
    with pool.connection() as conn:
        group_ids = allowed_groups(conn, user, data.group_ids)
        invitation_id = conn.execute(
            """INSERT INTO invitations (token, created_by, note, group_ids, max_uses, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (secrets.token_urlsafe(16), user["id"], data.note.strip(), group_ids, data.max_uses,
             datetime.now(timezone.utc) + timedelta(days=data.days)),
        ).fetchone()["id"]
        return conn.execute(LIST_SQL.format(where="WHERE i.id = %s"), (invitation_id,)).fetchone()


@router.delete("/{invitation_id}", status_code=204)
def revoke_invitation(invitation_id: int, user: dict = Depends(inviter)):
    """Le lien ne marche plus ; les comptes déjà créés restent."""
    where, params = visible(user)
    condition = f"{where} AND" if where else "WHERE"
    with pool.connection() as conn:
        deleted = conn.execute(
            f"DELETE FROM invitations i {condition} i.id = %s", (*params, invitation_id)
        ).rowcount
        if not deleted:
            raise HTTPException(404, "Invitation introuvable")


# ---------------------------------------------------------------- côté invité (sans compte)

VALID_SQL = """
SELECT i.*, COALESCE(NULLIF(c.display_name, ''), c.username) AS created_by_name
FROM invitations i JOIN users c ON c.id = i.created_by AND c.active
WHERE i.token = %s AND i.expires_at > now() AND (i.max_uses IS NULL OR i.uses < i.max_uses)
"""


def find_valid(conn, token: str, request: Request, lock: bool = False) -> dict:
    key = f"invitation:{request.client.host if request.client else '?'}"
    auth.check_throttle(key)
    invitation = conn.execute(VALID_SQL + (" FOR UPDATE OF i" if lock else ""), (token,)).fetchone()
    if invitation is None:
        # Deviner un jeton est hors de portée, mais les essais répétés sont freinés quand même.
        auth.record_failure(key)
        raise HTTPException(404, INVALID)
    return invitation


@router.get("/{token}/info")
def invitation_info(token: str, request: Request):
    """Ce que voit la personne invitée avant de créer son compte."""
    with pool.connection() as conn:
        invitation = find_valid(conn, token, request)
        names = conn.execute(
            "SELECT name FROM groups WHERE id = ANY(%s) ORDER BY name", (invitation["group_ids"],)
        ).fetchall()
        return {
            "created_by_name": invitation["created_by_name"],
            "note": invitation["note"],
            "groups": [n["name"] for n in names],
            "expires_at": invitation["expires_at"],
        }


@router.post("/{token}/signup", status_code=201)
def signup(token: str, data: SignupIn, request: Request, response: Response,
           holder: dict | None = Depends(auth.visitor)):
    """Crée le compte, le fait entrer dans les groupes de l'invitation et le connecte."""
    try:
        with pool.connection() as conn:
            invitation = find_valid(conn, token, request, lock=True)
            # Les droits de l'auteur ont pu changer depuis : on revérifie au moment de l'inscription.
            author = auth.load_user(conn, invitation["created_by"])
            if author is None or not can_invite(author):
                raise HTTPException(404, INVALID)
            existing = conn.execute(
                "SELECT id, permissions FROM groups WHERE id = ANY(%s)", (invitation["group_ids"],)
            ).fetchall()
            group_ids = [g["id"] for g in existing
                         if not g["permissions"] or auth.can(author, "manage_users")]
            user_id = conn.execute(
                """INSERT INTO users (username, display_name, password_hash, invitation_id, last_login_at)
                   VALUES (%s, %s, %s, %s, now()) RETURNING id""",
                (data.username, data.display_name.strip(), auth.hash_password(data.password),
                 invitation["id"]),
            ).fetchone()["id"]
            set_groups(conn, user_id, group_ids)
            conn.execute("UPDATE invitations SET uses = uses + 1 WHERE id = %s", (invitation["id"],))
            if holder and holder["is_guest"]:
                # Ce qui a été révisé en invité suit dans le nouveau compte.
                auth.merge_guest(conn, holder["id"], user_id)
            elif cookie := request.cookies.get(auth.COOKIE):
                conn.execute("DELETE FROM sessions WHERE token_hash = %s", (auth.token_hash(cookie),))
            auth.open_session(conn, user_id, request, response)
            return {"user": auth.load_user(conn, user_id)}
    except UniqueViolation:
        raise HTTPException(409, "Cet identifiant est déjà pris : choisis-en un autre")
