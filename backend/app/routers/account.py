from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth
from ..db import pool

router = APIRouter(prefix="/api/account", tags=["compte"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=8, max_length=200)


class ProfileIn(BaseModel):
    display_name: str = Field("", max_length=80)


@router.get("")
def me(user: dict | None = Depends(auth.optional_user)):
    """L'utilisateur connecté (ou null) et la liste des droits possibles."""
    return {"user": user, "permissions": auth.PERMISSIONS}


@router.post("/login")
def login(data: LoginIn, request: Request, response: Response):
    key = data.username.lower()
    auth.check_throttle(key)
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE lower(username) = lower(%s) AND active",
            (data.username,),
        ).fetchone()
        valid = auth.verify_password(data.password, row["password_hash"] if row else auth.DUMMY_HASH)
        if not (row and valid):
            auth.record_failure(key)
            raise HTTPException(401, "Identifiant ou mot de passe incorrect")
        auth.clear_failures(key)
        conn.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row["id"],))
        auth.open_session(conn, row["id"], request, response)
        return {"user": auth.load_user(conn, row["id"])}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    with pool.connection() as conn:
        auth.close_session(conn, request, response)


@router.put("/password", status_code=204)
def change_password(data: PasswordIn, request: Request, response: Response,
                    user: dict = Depends(auth.current_user)):
    with pool.connection() as conn:
        stored = conn.execute(
            "SELECT password_hash FROM users WHERE id = %s", (user["id"],)
        ).fetchone()["password_hash"]
        if not auth.verify_password(data.current, stored):
            raise HTTPException(400, "Mot de passe actuel incorrect")
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (auth.hash_password(data.new), user["id"]),
        )
        # Les autres appareils sont déconnectés ; celui-ci reçoit une nouvelle session.
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (user["id"],))
        auth.open_session(conn, user["id"], request, response)


@router.put("/profile")
def update_profile(data: ProfileIn, user: dict = Depends(auth.current_user)):
    with pool.connection() as conn:
        conn.execute(
            "UPDATE users SET display_name = %s WHERE id = %s",
            (data.display_name.strip(), user["id"]),
        )
        return auth.load_user(conn, user["id"])
