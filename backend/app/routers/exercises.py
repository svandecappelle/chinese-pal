from typing import Literal, get_args

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from pydantic import BaseModel, Field

from .. import auth, classifiers
from ..db import pool
from ..srs import CardState, previews

router = APIRouter(prefix="/api/exercises", tags=["exercices"])

# Modes de révision, dans l'ordre où les nouvelles cartes sont présentées
# (reconnaître avant de produire). « classifier » ne concerne que les mots qui en ont un.
Mode = Literal[
    "hanzi_to_meaning", "pinyin_to_meaning", "audio_to_meaning", "meaning_to_hanzi",
    "hanzi_to_pinyin", "meaning_to_pinyin", "classifier",
]
MODES = get_args(Mode)

# Cartes d'un exercice (une ligne par mot et par mode), avec leur état de révision éventuel.
# Paramètres : %(exercise_id)s, %(user_id)s (la progression est propre à chaque utilisateur). S'utilise en préfixe d'une requête sur `cards`.
CARDS_CTE = """
WITH ex AS (SELECT * FROM exercises WHERE id = %(exercise_id)s),
ex_words AS (
    SELECT w.id FROM words w, ex WHERE ex.all_words
    UNION
    SELECT dw.word_id FROM deck_words dw JOIN exercise_decks ed ON ed.deck_id = dw.deck_id
    WHERE ed.exercise_id = %(exercise_id)s
    UNION
    SELECT word_id FROM exercise_words WHERE exercise_id = %(exercise_id)s
),
ex_modes AS (
    SELECT m.mode, m.position FROM ex, unnest(ex.modes) WITH ORDINALITY AS m(mode, position)
),
cards AS (
    SELECT w.id AS word_id, m.mode, m.position AS mode_position,
           w.hanzi, w.pinyin, w.translation, w.classifiers,
           rs.ease, rs.interval_days, rs.repetitions, rs.lapses, rs.due_at, rs.first_reviewed_at
    FROM ex_words ew
    JOIN words w ON w.id = ew.id
    CROSS JOIN ex_modes m
    LEFT JOIN review_states rs
           ON rs.user_id = %(user_id)s AND rs.word_id = w.id AND rs.mode = m.mode
    WHERE m.mode <> 'classifier' OR cardinality(w.classifiers) > 0
)
"""

STATS_SQL = CARDS_CTE + """
SELECT count(*) AS total,
       count(*) FILTER (WHERE due_at IS NULL) AS unseen,
       count(*) FILTER (WHERE due_at <= now()) AS due,
       count(*) FILTER (WHERE first_reviewed_at >= date_trunc('day', now())) AS introduced_today
FROM cards
"""


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    modes: list[Mode] = Field(["hanzi_to_meaning"], min_length=1)
    new_per_day: int = Field(10, ge=0, le=500)
    all_words: bool = False
    deck_ids: list[int] = []
    word_ids: list[int] = []
    # À qui le cours est attribué : tous les comptes, ou certains groupes.
    everyone: bool = False
    group_ids: list[int] = []
    # Public : révisable par n'importe qui, sans compte.
    public: bool = False

    def db_params(self) -> dict:
        # Modes dédoublonnés et remis dans l'ordre canonique.
        return {**self.model_dump(), "modes": [m for m in MODES if m in self.modes]}


def card_payload(row: dict) -> dict:
    word_classifiers = row["classifiers"]
    payload = {
        "word_id": row["word_id"],
        "mode": row["mode"],
        "hanzi": row["hanzi"],
        "pinyin": row["pinyin"],
        "translation": row["translation"],
        "classifiers": [classifiers.described(c) for c in word_classifiers],
        "measure": classifiers.measure(row["hanzi"], row["pinyin"], word_classifiers),
        "is_new": row.get("due_at") is None,
        "previews": previews(CardState.from_row(row)),
    }
    if row["mode"] == "classifier":
        payload["choices"] = classifiers.choices(word_classifiers)
    return payload


def exercise_stats(conn, exercise: dict, user_id: int) -> dict:
    stats = conn.execute(STATS_SQL, {"exercise_id": exercise["id"], "user_id": user_id}).fetchone()
    new_left = max(0, exercise["new_per_day"] - stats["introduced_today"])
    stats["new_today"] = min(stats["unseen"], new_left)
    return stats


# Cours avec leur auteur, leurs groupes, et ce que l'utilisateur %(user_id)s peut en faire :
# `assigned` (il le révise : public, ou pour un compte : auteur, groupe visé, tous les comptes),
# `can_edit`. Un invité ou un visiteur (%(account)s faux) ne voit que les exercices publics.
EXERCISES_SQL = """
SELECT e.*, u.display_name AS owner_name, u.username AS owner_username,
       COALESCE((SELECT array_agg(group_id ORDER BY group_id)
                 FROM exercise_groups WHERE exercise_id = e.id), '{}') AS group_ids,
       (e.public OR (%(account)s AND (e.owner_id = %(user_id)s OR e.everyone OR EXISTS (
            SELECT 1 FROM exercise_groups eg JOIN user_groups ug ON ug.group_id = eg.group_id
            WHERE eg.exercise_id = e.id AND ug.user_id = %(user_id)s)))) AS assigned,
       (%(is_admin)s OR (%(can_create)s AND e.owner_id = %(user_id)s)) AS can_edit
FROM exercises e LEFT JOIN users u ON u.id = e.owner_id
"""


def user_params(user: dict | None) -> dict:
    """Paramètres d'EXERCISES_SQL pour un compte, un invité ou un visiteur (None)."""
    return {
        "user_id": user["id"] if user else None,
        "account": bool(user and not user["is_guest"]),
        "is_admin": bool(user and user["is_admin"]),
        "can_create": auth.can(user, "manage_courses"),
    }


def get_exercise_or_404(conn, exercise_id: int, user: dict | None) -> dict:
    """Le cours, s'il est attribué à l'utilisateur ou s'il peut le modifier."""
    exercise = conn.execute(
        EXERCISES_SQL + "WHERE e.id = %(id)s", {**user_params(user), "id": exercise_id}
    ).fetchone()
    if exercise is None or not (exercise["assigned"] or exercise["can_edit"]):
        raise HTTPException(404, "Exercice introuvable")
    return exercise


def get_editable_or_404(conn, exercise_id: int, user: dict) -> dict:
    exercise = get_exercise_or_404(conn, exercise_id, user)
    if not exercise["can_edit"]:
        raise HTTPException(403, "Seul l'auteur de l'exercice (ou un administrateur) peut le modifier")
    return exercise


def save_links(conn, exercise_id: int, data: ExerciseIn) -> None:
    conn.execute("DELETE FROM exercise_decks WHERE exercise_id = %s", (exercise_id,))
    conn.execute("DELETE FROM exercise_words WHERE exercise_id = %s", (exercise_id,))
    conn.execute("DELETE FROM exercise_groups WHERE exercise_id = %s", (exercise_id,))
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO exercise_groups (exercise_id, group_id) VALUES (%s, %s)",
            [(exercise_id, g) for g in set(data.group_ids)],
        )
        cur.executemany(
            "INSERT INTO exercise_decks (exercise_id, deck_id) VALUES (%s, %s)",
            [(exercise_id, d) for d in set(data.deck_ids)],
        )
        cur.executemany(
            "INSERT INTO exercise_words (exercise_id, word_id) VALUES (%s, %s)",
            [(exercise_id, w) for w in set(data.word_ids)],
        )


def interleave(due: list, new: list) -> list:
    """Répartit les nouvelles cartes régulièrement parmi les cartes à revoir."""
    if not due or not new:
        return due + new
    step = (len(due) + len(new)) / len(new)
    result, due_iter = [], iter(due)
    for i, card in enumerate(new):
        while len(result) < round(i * step):
            result.append(next(due_iter))
        result.append(card)
    result.extend(due_iter)
    return result


@router.get("")
def list_exercises(user: dict | None = Depends(auth.visitor)):
    """Cours attribués à l'utilisateur, puis ceux qu'il peut seulement modifier (administrateur).

    Sans compte : les exercices publics, avec la progression de l'invité s'il en a une.
    """
    with pool.connection() as conn:
        exercises = conn.execute(
            f"SELECT * FROM ({EXERCISES_SQL}) e WHERE assigned OR can_edit "
            "ORDER BY assigned DESC, all_words DESC, name",
            user_params(user),
        ).fetchall()
        for exercise in exercises:
            exercise["stats"] = exercise_stats(conn, exercise, user["id"] if user else None)
        return exercises


@router.get("/{exercise_id}")
def get_exercise(exercise_id: int, user: dict = Depends(auth.current_user)):
    with pool.connection() as conn:
        exercise = get_exercise_or_404(conn, exercise_id, user)
        exercise["deck_ids"] = [
            r["deck_id"] for r in conn.execute(
                "SELECT deck_id FROM exercise_decks WHERE exercise_id = %s", (exercise_id,))
        ]
        exercise["word_ids"] = [
            r["word_id"] for r in conn.execute(
                "SELECT word_id FROM exercise_words WHERE exercise_id = %s", (exercise_id,))
        ]
        return exercise


@router.post("", status_code=201)
def create_exercise(data: ExerciseIn, user: dict = Depends(auth.require("manage_courses"))):
    try:
        with pool.connection() as conn:
            exercise = conn.execute(
                """INSERT INTO exercises (name, description, modes, new_per_day, all_words,
                                          everyone, public, owner_id)
                   VALUES (%(name)s, %(description)s, %(modes)s, %(new_per_day)s, %(all_words)s,
                           %(everyone)s, %(public)s, %(owner_id)s)
                   RETURNING *""",
                {**data.db_params(), "owner_id": user["id"]},
            ).fetchone()
            save_links(conn, exercise["id"], data)
            return exercise
    except UniqueViolation:
        raise HTTPException(409, "Tu as déjà un exercice de ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Liste, mot ou groupe inconnu")


@router.put("/{exercise_id}")
def update_exercise(exercise_id: int, data: ExerciseIn, user: dict = Depends(auth.current_user)):
    try:
        with pool.connection() as conn:
            get_editable_or_404(conn, exercise_id, user)
            exercise = conn.execute(
                """UPDATE exercises SET name = %(name)s, description = %(description)s,
                       modes = %(modes)s, new_per_day = %(new_per_day)s,
                       all_words = %(all_words)s, everyone = %(everyone)s, public = %(public)s
                   WHERE id = %(id)s RETURNING *""",
                {**data.db_params(), "id": exercise_id},
            ).fetchone()
            save_links(conn, exercise_id, data)
            return exercise
    except UniqueViolation:
        raise HTTPException(409, "Tu as déjà un exercice de ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Liste, mot ou groupe inconnu")


@router.delete("/{exercise_id}", status_code=204)
def delete_exercise(exercise_id: int, user: dict = Depends(auth.current_user)):
    with pool.connection() as conn:
        get_editable_or_404(conn, exercise_id, user)
        conn.execute("DELETE FROM exercises WHERE id = %s", (exercise_id,))


@router.get("/{exercise_id}/session")
def get_session(exercise_id: int, user: dict | None = Depends(auth.visitor)):
    """File de cartes du jour : cartes dues + nouvelles cartes dans la limite quotidienne.

    Un exercice public se révise sans compte ; le compte invité n'est créé qu'à la première
    réponse (POST /api/reviews).
    """
    user_id = user["id"] if user else None
    with pool.connection() as conn:
        exercise = get_exercise_or_404(conn, exercise_id, user)
        stats = exercise_stats(conn, exercise, user_id)
        params = {"exercise_id": exercise_id, "user_id": user_id, "new_limit": stats["new_today"]}
        due = conn.execute(
            CARDS_CTE + "SELECT * FROM cards WHERE due_at <= now() ORDER BY due_at LIMIT 500",
            params,
        ).fetchall()
        new = conn.execute(
            CARDS_CTE + """SELECT * FROM cards WHERE due_at IS NULL
                           ORDER BY mode_position, word_id LIMIT %(new_limit)s""",
            params,
        ).fetchall()
        cards = interleave(due, new)
        # Première phrase d'exemple de chaque mot, affichée avec la réponse.
        examples = {
            e["word_id"]: e for e in conn.execute(
                """SELECT DISTINCT ON (word_id) word_id, hanzi, pinyin, translation
                   FROM examples WHERE word_id = ANY(%s) ORDER BY word_id, id""",
                ([c["word_id"] for c in cards],),
            )
        }
    payloads = []
    for c in cards:
        payload = card_payload(c)
        payload["example"] = examples.get(c["word_id"])
        payloads.append(payload)
    return {"exercise": exercise, "stats": stats, "cards": payloads}


@router.get("/{exercise_id}/progress")
def get_progress(exercise_id: int, user: dict = Depends(auth.current_user)):
    """Suivi du cours pour son auteur : la progression de chaque élève à qui il est attribué."""
    with pool.connection() as conn:
        exercise = get_editable_or_404(conn, exercise_id, user)
        students = conn.execute(
            """SELECT u.id, u.username, u.display_name,
                      (SELECT max(reviewed_at) FROM review_log WHERE user_id = u.id) AS last_review
               FROM users u
               WHERE u.active AND NOT u.is_guest AND (%(everyone)s OR u.id IN (
                   SELECT ug.user_id FROM user_groups ug
                   JOIN exercise_groups eg ON eg.group_id = ug.group_id
                   WHERE eg.exercise_id = %(id)s
                   UNION
                   -- Exercice public : aussi les comptes qui l'ont commencé d'eux-mêmes.
                   SELECT rs.user_id FROM review_states rs
                   JOIN exercises e ON e.id = %(id)s AND e.public
                   WHERE (rs.word_id, rs.mode) IN (SELECT word_id, mode FROM cards)))
               ORDER BY lower(u.username)""".replace(
                "SELECT u.id", CARDS_CTE + "SELECT u.id", 1),
            {"everyone": exercise["everyone"], "id": exercise_id,
             "exercise_id": exercise_id, "user_id": None},
        ).fetchall()
        for student in students:
            student["stats"] = exercise_stats(conn, exercise, student["id"])
        # Visiteurs sans compte qui ont révisé cet exercice (nombre seulement).
        guests = conn.execute(
            CARDS_CTE + """SELECT count(DISTINCT rs.user_id) AS n
                           FROM cards c
                           JOIN review_states rs ON rs.word_id = c.word_id AND rs.mode = c.mode
                           JOIN users u ON u.id = rs.user_id AND u.is_guest""",
            {"exercise_id": exercise_id, "user_id": None},
        ).fetchone()["n"] if exercise["public"] else 0
        return {"exercise": exercise, "students": students, "guests": guests}
