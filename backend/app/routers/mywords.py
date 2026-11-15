"""Mes mots : les mots qu'un élève garde pour lui (depuis la lecture assistée ou la fiche d'un mot),
et ses notes personnelles (moyen mnémotechnique).

Un mot absent du vocabulaire se garde aussi : c'est alors un mot personnel (`words.owner_id`),
avec le sens donné par l'élève, visible de lui seul ; le retirer de la liste le supprime.

La liste est un exercice personnel (`exercises.personal`), créé au premier mot ajouté : il se
révise, se teste et s'imprime comme les autres, et le fil de révision le reprend. Il n'est pas
modifiable depuis l'éditeur d'exercices.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from .. import auth
from ..db import pool
from .exercises import MODES, exercise_stats

router = APIRouter(prefix="/api/my-words", tags=["mes mots"])

NAMES = ("Mes mots", "Mes mots personnels")
# Reconnaître puis produire : sens, pinyin, caractères tracés (modifiable avant chaque test).
DEFAULT_MODES = ["hanzi_to_meaning", "hanzi_to_pinyin", "meaning_to_hanzi"]
NEW_PER_DAY = 10
MAX_WORDS = 2000


def personal_exercise(conn, user: dict, create: bool = False) -> dict | None:
    exercise = conn.execute(
        "SELECT * FROM exercises WHERE owner_id = %s AND personal", (user["id"],)).fetchone()
    if exercise or not create:
        return exercise
    taken = {r["name"] for r in conn.execute(
        "SELECT name FROM exercises WHERE owner_id = %s AND name = ANY(%s)", (user["id"], list(NAMES)))}
    name = next(n for n in NAMES if n not in taken)
    return conn.execute(
        """INSERT INTO exercises (name, description, modes, new_per_day, owner_id, personal)
           VALUES (%s, %s, %s, %s, %s, true) RETURNING *""",
        (name, "Les mots que tu as gardés, depuis la lecture ou la fiche d'un mot",
         [m for m in MODES if m in DEFAULT_MODES], NEW_PER_DAY, user["id"]),
    ).fetchone()


def require_word(conn, word_id: int, user: dict) -> dict:
    """Mot du vocabulaire commun, ou mot personnel de cet élève."""
    word = conn.execute(
        "SELECT id, owner_id FROM words WHERE id = %s AND (owner_id IS NULL OR owner_id = %s)",
        (word_id, user["id"])).fetchone()
    if word is None:
        raise HTTPException(404, "Mot introuvable")
    return word


def add_to_list(conn, user: dict, word_id: int) -> int:
    exercise = personal_exercise(conn, user, create=True)
    count = conn.execute("SELECT count(*) AS n FROM exercise_words WHERE exercise_id = %s",
                         (exercise["id"],)).fetchone()["n"]
    if count >= MAX_WORDS:
        raise HTTPException(400, f"Mes mots en compte déjà {MAX_WORDS}")
    conn.execute(
        "INSERT INTO exercise_words (exercise_id, word_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (exercise["id"], word_id))
    return exercise["id"]


HANZI = re.compile(r"^[\u3400-\u9fff\uf900-\ufaff]{1,8}$")


class NewWordIn(BaseModel):
    hanzi: str
    pinyin: str = Field(min_length=1, max_length=60)
    translation: str = Field(min_length=1, max_length=200)

    @field_validator("hanzi")
    @classmethod
    def chinese(cls, value: str) -> str:
        value = value.strip()
        if not HANZI.match(value):
            raise ValueError("de 1 à 8 caractères chinois")
        return value

    @field_validator("pinyin", "translation")
    @classmethod
    def trimmed(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("vide")
        return value.strip()


class TranslationIn(BaseModel):
    translation: str = Field(min_length=1, max_length=200)


@router.get("")
def list_my_words(user: dict = Depends(auth.current_user)):
    """Mes mots (les plus récents d'abord) avec leurs notes, et l'exercice qui les révise."""
    with pool.connection() as conn:
        exercise = personal_exercise(conn, user)
        words = conn.execute(
            """SELECT w.id AS word_id, w.hanzi, w.pinyin, w.translation, n.note,
                      w.owner_id IS NOT NULL AS personal
               FROM exercise_words ew JOIN words w ON w.id = ew.word_id
               LEFT JOIN word_notes n ON n.user_id = %s AND n.word_id = w.id
               WHERE ew.exercise_id = %s ORDER BY ew.added_at DESC, w.id DESC""",
            (user["id"], exercise["id"] if exercise else None),
        ).fetchall() if exercise else []
        stats = exercise_stats(conn, exercise, user["id"]) if exercise else None
        notes = conn.execute(
            """SELECT w.id AS word_id, w.hanzi, w.pinyin, w.translation, n.note,
                      w.owner_id IS NOT NULL AS personal
               FROM word_notes n JOIN words w ON w.id = n.word_id
               WHERE n.user_id = %s AND w.id <> ALL(%s) ORDER BY n.updated_at DESC""",
            (user["id"], [w["word_id"] for w in words]),
        ).fetchall()
    return {
        "exercise": {"id": exercise["id"], "name": exercise["name"], "stats": stats} if exercise else None,
        "words": words,
        # Mots annotés mais pas dans la liste.
        "notes": notes,
    }


@router.post("", status_code=201)
def add_new_word(data: NewWordIn, user: dict = Depends(auth.current_user)):
    """Garde un mot absent du vocabulaire, avec son sens : un mot personnel, visible de l'élève
    seul. S'il est en fait dans le vocabulaire commun (mêmes caractères et pinyin), c'est lui qui
    est gardé ; un mot personnel déjà créé est repris (son sens mis à jour)."""
    with pool.connection() as conn:
        word = conn.execute(
            """SELECT id, hanzi, pinyin, translation, false AS personal FROM words
               WHERE hanzi = %s AND pinyin = %s AND owner_id IS NULL""",
            (data.hanzi, data.pinyin)).fetchone()
        if word is None:
            word = conn.execute(
                """INSERT INTO words (hanzi, pinyin, translation, owner_id) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (owner_id, hanzi, pinyin) WHERE owner_id IS NOT NULL
                   DO UPDATE SET translation = EXCLUDED.translation
                   RETURNING id, hanzi, pinyin, translation, true AS personal""",
                (data.hanzi, data.pinyin, data.translation, user["id"])).fetchone()
        exercise_id = add_to_list(conn, user, word["id"])
    return {"word_id": word["id"], "hanzi": word["hanzi"], "pinyin": word["pinyin"],
            "translation": word["translation"], "personal": word["personal"],
            "in_list": True, "exercise_id": exercise_id}


@router.patch("/{word_id}")
def edit_personal_word(word_id: int, data: TranslationIn, user: dict = Depends(auth.current_user)):
    """Corrige le sens d'un de ses mots personnels."""
    with pool.connection() as conn:
        word = conn.execute(
            """UPDATE words SET translation = %s WHERE id = %s AND owner_id = %s
               RETURNING id AS word_id, hanzi, pinyin, translation""",
            (data.translation.strip(), word_id, user["id"])).fetchone()
    if word is None:
        raise HTTPException(404, "Mot personnel introuvable")
    return word


@router.get("/{word_id}")
def my_word(word_id: int, user: dict = Depends(auth.current_user)):
    """Ce mot est-il dans Mes mots, et ma note dessus."""
    with pool.connection() as conn:
        word = require_word(conn, word_id, user)
        exercise = personal_exercise(conn, user)
        in_list = bool(exercise) and conn.execute(
            "SELECT 1 FROM exercise_words WHERE exercise_id = %s AND word_id = %s",
            (exercise["id"], word_id)).fetchone() is not None
        note = conn.execute("SELECT note FROM word_notes WHERE user_id = %s AND word_id = %s",
                            (user["id"], word_id)).fetchone()
    return {"word_id": word_id, "in_list": in_list, "note": note["note"] if note else None,
            "personal": word["owner_id"] is not None}


@router.put("/{word_id}")
def add_my_word(word_id: int, user: dict = Depends(auth.current_user)):
    """Ajoute le mot à Mes mots (crée l'exercice personnel au premier mot)."""
    with pool.connection() as conn:
        require_word(conn, word_id, user)
        exercise_id = add_to_list(conn, user, word_id)
    return {"word_id": word_id, "in_list": True, "exercise_id": exercise_id}


@router.delete("/{word_id}", status_code=204)
def remove_my_word(word_id: int, user: dict = Depends(auth.current_user)):
    """Retire le mot de Mes mots (sa progression et sa note restent). Un mot personnel est
    supprimé, avec sa progression et sa note."""
    with pool.connection() as conn:
        if conn.execute("DELETE FROM words WHERE id = %s AND owner_id = %s",
                        (word_id, user["id"])).rowcount:
            return
        exercise = personal_exercise(conn, user)
        if exercise:
            conn.execute("DELETE FROM exercise_words WHERE exercise_id = %s AND word_id = %s",
                         (exercise["id"], word_id))


class NoteIn(BaseModel):
    note: str = Field("", max_length=500)


@router.put("/{word_id}/note")
def set_note(word_id: int, data: NoteIn, user: dict = Depends(auth.current_user)):
    """Note personnelle sur un mot (vide : supprimée). Affichée avec la réponse."""
    note = data.note.strip()
    with pool.connection() as conn:
        require_word(conn, word_id, user)
        if note:
            conn.execute(
                """INSERT INTO word_notes (user_id, word_id, note) VALUES (%s, %s, %s)
                   ON CONFLICT (user_id, word_id) DO UPDATE SET note = EXCLUDED.note, updated_at = now()""",
                (user["id"], word_id, note))
        else:
            conn.execute("DELETE FROM word_notes WHERE user_id = %s AND word_id = %s", (user["id"], word_id))
    return {"word_id": word_id, "note": note or None}
