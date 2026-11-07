"""Commandes d'exploitation, lancées dans le conteneur (voir `make password ACCOUNT=...`).

    python -m app.cli password <identifiant>   nouveau mot de passe (créé administrateur si absent)
"""

import sys

import psycopg

from . import auth
from .config import settings


def password(username: str) -> None:
    new = auth.generate_password()
    with psycopg.connect(settings.database_url) as conn:
        row = conn.execute(
            """UPDATE users SET password_hash = %s, active = true
               WHERE lower(username) = lower(%s) RETURNING id""",
            (auth.hash_password(new), username),
        ).fetchone()
        if row is None:
            conn.execute(
                """INSERT INTO users (username, display_name, password_hash, is_admin)
                   VALUES (%s, %s, %s, true)""",
                (username, username, auth.hash_password(new)),
            )
            print(f"Administrateur « {username} » créé.")
        else:
            conn.execute("DELETE FROM sessions WHERE user_id = %s", (row[0],))
            print(f"Compte « {username} » : mot de passe remplacé, sessions fermées.")
    print(f"Mot de passe : {new}")


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "password":
        password(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
