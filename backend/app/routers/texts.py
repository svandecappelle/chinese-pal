"""Textes gradués : de courts textes (niveaux HSK) et, pour chacun, la part de mots déjà vus par
l'élève. Un texte « à ta mesure » contient surtout des mots connus et quelques mots nouveaux ; il
se lit dans la lecture assistée, mots nouveaux surlignés.

Les textes sont en base (`graded_texts`). Ceux écrits pour l'application (data/textes.json) y
sont chargés au démarrage, sans écraser les modifications. Les professeurs et administrateurs
(droit « manage_courses ») les modifient, en écrivent de nouveaux et les masquent aux élèves.
"""

import json
import logging
import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from .. import auth, drills
from ..db import pool
from .vocab import DATA_DIR

router = APIRouter(prefix="/api/texts", tags=["textes gradués"])
log = logging.getLogger(__name__)

# Part de mots connus (en occurrences) d'un texte à lire maintenant : assez pour suivre, avec
# encore quelques mots à découvrir.
GOOD_FIT = 0.75
EDIT_PERMISSION = "manage_courses"
Editor = Annotated[dict, Depends(auth.require(EDIT_PERMISSION))]
FIELDS = "id, level, title, title_fr, text, translation, hidden, builtin_id"
CHINESE = re.compile(r"[㐀-鿿]")


def seed_texts() -> None:
    """Charge les textes fournis absents de la base (un texte modifié ou masqué n'est pas touché)."""
    try:
        builtin = json.loads((DATA_DIR / "textes.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return
    with pool.connection() as conn:
        added = 0
        for t in builtin:
            added += conn.execute(
                """INSERT INTO graded_texts (builtin_id, level, title, title_fr, text, translation)
                   VALUES (%(id)s, %(level)s, %(title)s, %(title_fr)s, %(text)s, %(translation)s)
                   ON CONFLICT (builtin_id) DO NOTHING""", t).rowcount
    if added:
        log.info("Textes gradués chargés : %d", added)


def can_edit(user: dict | None) -> bool:
    return user is not None and auth.can(user, EDIT_PERMISSION)


@lru_cache(maxsize=512)
def words_of(text: str) -> tuple[str, ...]:
    """Mots chinois du texte, dans l'ordre (avec répétitions)."""
    return tuple(piece for piece, is_word in drills.reading_tokens(text) if is_word)


def vocabulary(conn, words) -> dict[str, int]:
    """Mots du vocabulaire présents dans ces mots ou dans leurs morceaux (jusqu'à 4 caractères)."""
    pieces = {w[i:j] for w in words for i in range(len(w)) for j in range(i + 1, min(len(w), i + 4) + 1)}
    found: dict[str, int] = {}
    for row in conn.execute(
            "SELECT id, hanzi FROM words WHERE hanzi = ANY(%s) AND owner_id IS NULL ORDER BY id",
            (list(pieces),)):
        found.setdefault(row["hanzi"], row["id"])
    return found


def units(words: tuple[str, ...], vocab: dict[str, int]) -> list[str]:
    """Les mots du texte ramenés au vocabulaire : un mot du dictionnaire absent du vocabulaire
    (吃饭, 每天, 一个…) compte comme ses morceaux qui y sont (吃 + 饭) ; un caractère qui n'y est
    pas reste tel quel (hors vocabulaire)."""
    result = []
    for word in words:
        i = 0
        while i < len(word):
            size = next((n for n in range(min(4, len(word) - i), 0, -1) if word[i:i + n] in vocab), 1)
            result.append(word[i:i + size])
            i += size
    return result


def seen_words(conn, user: dict | None, word_ids: list[int]) -> set[int] | None:
    """Mots déjà révisés (au moins une réponse, dans n'importe quel mode) ; None sans progression."""
    if user is None:
        return None
    return {r["word_id"] for r in conn.execute(
        "SELECT DISTINCT word_id FROM review_states WHERE user_id = %s AND word_id = ANY(%s)",
        (user["id"], word_ids))}


def coverage(words: tuple[str, ...], vocab: dict[str, int], seen: set[int] | None) -> dict:
    parts = units(words, vocab)
    total = len(parts)
    known = sum(1 for w in parts if seen is not None and vocab.get(w) in seen)
    fresh = [w for w in dict.fromkeys(parts) if w in vocab and (seen is None or vocab[w] not in seen)]
    outside = {w for w in parts if w not in vocab}
    return {
        "words": total,
        "known": None if seen is None else (known / total if total else 0),
        "new_words": fresh,
        "outside": len(outside),
    }


def tokenized(texts: list[dict]) -> dict[int, tuple[str, ...]]:
    try:
        return {t["id"]: words_of(t["text"]) for t in texts}
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))


@router.get("")
def list_texts(user: dict | None = Depends(auth.visitor)):
    """Les textes, avec pour chacun la part de mots connus de l'élève (compte ou invité) ; les
    plus adaptés (assez de mots connus, quelques nouveaux) d'abord. Les textes masqués ne sont
    listés que pour les professeurs (`hidden`)."""
    editor = can_edit(user)
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {FIELDS} FROM graded_texts WHERE %s OR NOT hidden ORDER BY level, id",
            (editor,)).fetchall()
        all_words = tokenized(rows)
        vocab = vocabulary(conn, {w for words in all_words.values() for w in words})
        seen = seen_words(conn, user, list(vocab.values()))
    result = []
    for t in rows:
        cov = coverage(all_words[t["id"]], vocab, seen)
        fits = not t["hidden"] and cov["known"] is not None and GOOD_FIT <= cov["known"] < 1
        result.append({k: t[k] for k in ("id", "level", "title", "title_fr", "hidden")}
                      | {"length": len(t["text"]), "fits": fits} | cov)
    # À ta mesure d'abord (les plus connus en tête), puis par niveau.
    result.sort(key=lambda t: (not t["fits"], -(t["known"] or 0) if t["fits"] else 0, t["level"], t["id"]))
    return {"progress": seen is not None, "can_edit": editor, "texts": result}


def text_row(conn, text_id: int, user: dict | None) -> dict:
    row = conn.execute(f"SELECT {FIELDS} FROM graded_texts WHERE id = %s", (text_id,)).fetchone()
    if row is None or (row["hidden"] and not can_edit(user)):
        raise HTTPException(404, "Texte introuvable")
    return row


@router.get("/{text_id}")
def get_text(text_id: int, user: dict | None = Depends(auth.visitor)):
    with pool.connection() as conn:
        text = text_row(conn, text_id, user)
        words = tokenized([text])[text_id]
        vocab = vocabulary(conn, set(words))
        seen = seen_words(conn, user, list(vocab.values()))
    cov = coverage(words, vocab, seen)
    return text | cov | {"new_word_ids": [vocab[w] for w in cov["new_words"]], "can_edit": can_edit(user)}


class TextIn(BaseModel):
    level: int = Field(ge=1, le=9)
    title: str = Field(min_length=1, max_length=60)
    title_fr: str = Field("", max_length=120)
    text: str = Field(min_length=1, max_length=3000)
    translation: str = Field("", max_length=6000)
    hidden: bool = False

    @field_validator("title", "title_fr", "text", "translation")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()

    @field_validator("text")
    @classmethod
    def chinese(cls, value: str) -> str:
        if not CHINESE.search(value):
            raise ValueError("le texte doit être en chinois")
        return value

    @field_validator("title")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value:
            raise ValueError("titre vide")
        return value


class HiddenIn(BaseModel):
    hidden: bool


@router.post("", status_code=201)
def create_text(data: TextIn, user: Editor):
    with pool.connection() as conn:
        return conn.execute(
            f"""INSERT INTO graded_texts (level, title, title_fr, text, translation, hidden, created_by)
                VALUES (%(level)s, %(title)s, %(title_fr)s, %(text)s, %(translation)s, %(hidden)s, %(user)s)
                RETURNING {FIELDS}""", data.model_dump() | {"user": user["id"]}).fetchone()


@router.put("/{text_id}")
def update_text(text_id: int, data: TextIn, _: Editor):
    with pool.connection() as conn:
        row = conn.execute(
            f"""UPDATE graded_texts SET level = %(level)s, title = %(title)s, title_fr = %(title_fr)s,
                       text = %(text)s, translation = %(translation)s, hidden = %(hidden)s, updated_at = now()
                WHERE id = %(id)s RETURNING {FIELDS}""", data.model_dump() | {"id": text_id}).fetchone()
    if row is None:
        raise HTTPException(404, "Texte introuvable")
    return row


@router.put("/{text_id}/hidden")
def set_hidden(text_id: int, data: HiddenIn, _: Editor):
    """Masque le texte aux élèves (il reste visible et modifiable par les professeurs), ou le
    rend de nouveau visible."""
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE graded_texts SET hidden = %s, updated_at = now() WHERE id = %s RETURNING id, hidden",
            (data.hidden, text_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Texte introuvable")
    return row
