"""Textes gradués : de courts textes (niveaux HSK 1 à 3, écrits pour l'application) et, pour chacun,
la part de mots déjà vus par l'élève. Un texte « à ta mesure » contient surtout des mots connus et
quelques mots nouveaux ; il se lit dans la lecture assistée, mots nouveaux surlignés.
"""

import json
from functools import cache

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, drills
from ..db import pool
from .vocab import DATA_DIR

router = APIRouter(prefix="/api/texts", tags=["textes gradués"])

# Part de mots connus (en occurrences) d'un texte à lire maintenant : assez pour suivre, avec
# encore quelques mots à découvrir.
GOOD_FIT = 0.75


@cache
def texts() -> list[dict]:
    return json.loads((DATA_DIR / "textes.json").read_text(encoding="utf-8"))


@cache
def text_words(text_id: int) -> tuple[str, ...]:
    """Mots chinois du texte, dans l'ordre (avec répétitions)."""
    text = next(t for t in texts() if t["id"] == text_id)
    return tuple(piece for piece, is_word in drills.reading_tokens(text["text"]) if is_word)


def vocabulary(conn, words) -> dict[str, int]:
    """Mots du vocabulaire présents dans ces mots ou dans leurs morceaux (jusqu'à 4 caractères)."""
    pieces = {w[i:j] for w in words for i in range(len(w)) for j in range(i + 1, min(len(w), i + 4) + 1)}
    found: dict[str, int] = {}
    for row in conn.execute("SELECT id, hanzi FROM words WHERE hanzi = ANY(%s) AND owner_id IS NULL ORDER BY id", (list(pieces),)):
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


@router.get("")
def list_texts(user: dict | None = Depends(auth.visitor)):
    """Les textes, avec pour chacun la part de mots connus de l'élève (compte ou invité) ; les
    plus adaptés (assez de mots connus, quelques nouveaux) d'abord."""
    try:
        all_words = {t["id"]: text_words(t["id"]) for t in texts()}
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))
    with pool.connection() as conn:
        vocab = vocabulary(conn, {w for words in all_words.values() for w in words})
        seen = seen_words(conn, user, list(vocab.values()))
    result = []
    for t in texts():
        cov = coverage(all_words[t["id"]], vocab, seen)
        fits = cov["known"] is not None and GOOD_FIT <= cov["known"] < 1
        result.append({k: t[k] for k in ("id", "level", "title", "title_fr")}
                      | {"length": len(t["text"]), "fits": fits} | cov)
    # À ta mesure d'abord (les plus connus en tête), puis par niveau.
    result.sort(key=lambda t: (not t["fits"], -(t["known"] or 0) if t["fits"] else 0, t["level"], t["id"]))
    return {"progress": seen is not None, "texts": result}


@router.get("/{text_id}")
def get_text(text_id: int, user: dict | None = Depends(auth.visitor)):
    text = next((t for t in texts() if t["id"] == text_id), None)
    if text is None:
        raise HTTPException(404, "Texte introuvable")
    try:
        words = text_words(text_id)
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))
    with pool.connection() as conn:
        vocab = vocabulary(conn, set(words))
        seen = seen_words(conn, user, list(vocab.values()))
    new_ids = [vocab[w] for w in coverage(words, vocab, seen)["new_words"]]
    return text | coverage(words, vocab, seen) | {"new_word_ids": new_ids}
