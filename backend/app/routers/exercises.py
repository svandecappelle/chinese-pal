from typing import Literal, get_args

from fastapi import APIRouter, HTTPException
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from pydantic import BaseModel, Field

from ..db import pool
from ..srs import CardState, previews

router = APIRouter(prefix="/api/exercises", tags=["exercices"])

# Modes de révision, dans l'ordre où les nouvelles cartes sont présentées
# (reconnaître avant de produire).
Mode = Literal[
    "hanzi_to_meaning", "pinyin_to_meaning", "audio_to_meaning", "meaning_to_hanzi",
    "hanzi_to_pinyin", "meaning_to_pinyin",
]
MODES = get_args(Mode)

# Cartes d'un exercice (une ligne par mot et par mode), avec leur état de révision éventuel.
# Paramètre : %(exercise_id)s. S'utilise en préfixe d'une requête sur `cards`.
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
           w.hanzi, w.pinyin, w.translation,
           rs.ease, rs.interval_days, rs.repetitions, rs.lapses, rs.due_at, rs.first_reviewed_at
    FROM ex_words ew
    JOIN words w ON w.id = ew.id
    CROSS JOIN ex_modes m
    LEFT JOIN review_states rs ON rs.word_id = w.id AND rs.mode = m.mode
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

    def db_params(self) -> dict:
        # Modes dédoublonnés et remis dans l'ordre canonique.
        return {**self.model_dump(), "modes": [m for m in MODES if m in self.modes]}


def card_payload(row: dict) -> dict:
    return {
        "word_id": row["word_id"],
        "mode": row["mode"],
        "hanzi": row["hanzi"],
        "pinyin": row["pinyin"],
        "translation": row["translation"],
        "is_new": row.get("due_at") is None,
        "previews": previews(CardState.from_row(row)),
    }


def exercise_stats(conn, exercise: dict) -> dict:
    stats = conn.execute(STATS_SQL, {"exercise_id": exercise["id"]}).fetchone()
    new_left = max(0, exercise["new_per_day"] - stats["introduced_today"])
    stats["new_today"] = min(stats["unseen"], new_left)
    return stats


def get_exercise_or_404(conn, exercise_id: int) -> dict:
    exercise = conn.execute("SELECT * FROM exercises WHERE id = %s", (exercise_id,)).fetchone()
    if exercise is None:
        raise HTTPException(404, "Exercice introuvable")
    return exercise


def save_links(conn, exercise_id: int, data: ExerciseIn) -> None:
    conn.execute("DELETE FROM exercise_decks WHERE exercise_id = %s", (exercise_id,))
    conn.execute("DELETE FROM exercise_words WHERE exercise_id = %s", (exercise_id,))
    with conn.cursor() as cur:
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
def list_exercises():
    with pool.connection() as conn:
        exercises = conn.execute("SELECT * FROM exercises ORDER BY all_words DESC, name").fetchall()
        for exercise in exercises:
            exercise["stats"] = exercise_stats(conn, exercise)
        return exercises


@router.get("/{exercise_id}")
def get_exercise(exercise_id: int):
    with pool.connection() as conn:
        exercise = get_exercise_or_404(conn, exercise_id)
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
def create_exercise(data: ExerciseIn):
    try:
        with pool.connection() as conn:
            exercise = conn.execute(
                """INSERT INTO exercises (name, description, modes, new_per_day, all_words)
                   VALUES (%(name)s, %(description)s, %(modes)s, %(new_per_day)s, %(all_words)s)
                   RETURNING *""",
                data.db_params(),
            ).fetchone()
            save_links(conn, exercise["id"], data)
            return exercise
    except UniqueViolation:
        raise HTTPException(409, "Un exercice porte déjà ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Liste ou mot inconnu")


@router.put("/{exercise_id}")
def update_exercise(exercise_id: int, data: ExerciseIn):
    try:
        with pool.connection() as conn:
            exercise = conn.execute(
                """UPDATE exercises SET name = %(name)s, description = %(description)s,
                       modes = %(modes)s, new_per_day = %(new_per_day)s,
                       all_words = %(all_words)s
                   WHERE id = %(id)s RETURNING *""",
                {**data.db_params(), "id": exercise_id},
            ).fetchone()
            if exercise is None:
                raise HTTPException(404, "Exercice introuvable")
            save_links(conn, exercise_id, data)
            return exercise
    except UniqueViolation:
        raise HTTPException(409, "Un exercice porte déjà ce nom")
    except ForeignKeyViolation:
        raise HTTPException(400, "Liste ou mot inconnu")


@router.delete("/{exercise_id}", status_code=204)
def delete_exercise(exercise_id: int):
    with pool.connection() as conn:
        if conn.execute("DELETE FROM exercises WHERE id = %s", (exercise_id,)).rowcount == 0:
            raise HTTPException(404, "Exercice introuvable")


@router.get("/{exercise_id}/session")
def get_session(exercise_id: int):
    """File de cartes du jour : cartes dues + nouvelles cartes dans la limite quotidienne."""
    with pool.connection() as conn:
        exercise = get_exercise_or_404(conn, exercise_id)
        stats = exercise_stats(conn, exercise)
        params = {"exercise_id": exercise_id, "new_limit": stats["new_today"]}
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
