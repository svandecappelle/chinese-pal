from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import drills
from ..db import pool
from ..ime import dictionary, normalize

router = APIRouter(prefix="/api/ime", tags=["saisie"])


@router.get("")
def candidates(
    q: str = Query(max_length=60, description="Pinyin tapé, tons facultatifs"),
    limit: int = Query(45, ge=1, le=100),
):
    """Caractères candidats pour un pinyin, les mots du vocabulaire en premier."""
    typed = normalize(q)
    if not typed:
        return {"typed": "", "candidates": []}
    with pool.connection() as conn:
        rows = conn.execute("SELECT hanzi, pinyin FROM words").fetchall()
    preferred = {(row["hanzi"], normalize(row["pinyin"])) for row in rows}
    try:
        found = dictionary.candidates(typed, preferred, limit)
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))
    return {"typed": typed, "candidates": found}


@router.get("/lectures")
def readings(q: str = Query(max_length=400, description="Mots séparés par des espaces")):
    """Lecture la plus courante (chiffres de ton) de chaque mot, d'après CC-CEDICT ; un mot absent
    du dictionnaire est lu caractère par caractère. Sert aux caractères tapés hors vocabulaire."""
    found = {}
    try:
        for word in dict.fromkeys(q.split()):
            reading = dictionary.reading_of(word)
            if reading is None:
                parts = [dictionary.reading_of(char) for char in word]
                reading = " ".join(parts) if all(parts) else None
            if reading:
                found[word] = reading
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))
    return found


class ReadingIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@router.post("/lecture")
def assisted_reading(data: ReadingIn):
    """Lecture assistée : le texte découpé en mots, avec pour chacun le pinyin et le sens.

    Le sens vient du vocabulaire (en français) s'il contient le mot, sinon de CC-CEDICT (en
    anglais). Un mot inconnu du dictionnaire est lu caractère par caractère."""
    try:
        tokens = drills.reading_tokens(data.text)
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))
    hanzi = {text for text, is_word in tokens if is_word}
    with pool.connection() as conn:
        known = {}
        for row in conn.execute(
            "SELECT id, hanzi, pinyin, translation FROM words WHERE hanzi = ANY(%s) ORDER BY id",
            (list(hanzi),),
        ):
            known.setdefault(row["hanzi"], row)
    words = {}
    for word in hanzi:
        row = known.get(word)
        reading = dictionary.reading_of(word)
        if reading is None and row is None:
            parts = [dictionary.reading_of(char) for char in word]
            reading = " ".join(parts) if all(parts) else None
        words[word] = {
            "word_id": row["id"] if row else None,
            "pinyin": row["pinyin"] if row else None,
            "reading": reading,
            "translation": row["translation"] if row else None,
            "english": dictionary.definition_of(word),
        }
    return {
        "tokens": [{"text": text, "word": is_word} for text, is_word in tokens],
        "words": words,
    }
