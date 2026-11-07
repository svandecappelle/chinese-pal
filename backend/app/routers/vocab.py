import csv
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from pydantic import BaseModel, Field

from .. import classifiers
from ..db import pool
from ..ime import dictionary

router = APIRouter(prefix="/api", tags=["vocabulaire"])

DATA_DIR = Path(__file__).parent.parent / "data"

# Listes prêtes à importer : fichiers data/<id>.tsv (colonnes hanzi, pinyin, traduction)
# et, facultatif, data/<id>_exemples.tsv (colonnes hanzi, phrase, pinyin, traduction).
# Les classificateurs des mots de toutes les listes sont dans data/classificateurs.tsv
# (colonnes hanzi, pinyin, classificateurs séparés par des espaces).
PACKS = {
    "hsk1": ("HSK 1", "HSK 2.0 niveau 1"),
    "hsk2": ("HSK 2", "HSK 2.0 niveau 2"),
    "hsk3": ("HSK 3", "HSK 2.0 niveau 3"),
}


class DeckIn(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None


Classifier = Annotated[str, Field(pattern=r"^[㐀-鿿]{1,2}$")]


class WordIn(BaseModel):
    hanzi: str = Field(min_length=1)
    pinyin: str = Field(min_length=1)
    translation: str = Field(min_length=1)
    deck_id: int | None = None
    # Absents : ceux du dictionnaire, s'il en indique.
    classifiers: list[Classifier] | None = Field(None, max_length=4)


class ClassifiersIn(BaseModel):
    classifiers: list[Classifier] = Field(max_length=4)


class ExampleIn(BaseModel):
    hanzi: str = Field(min_length=1)
    pinyin: str = ""
    translation: str = ""


def read_tsv(name: str) -> list[dict]:
    path = DATA_DIR / name
    if not path.exists():
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def read_pack(pack_id: str) -> list[dict]:
    return read_tsv(f"{pack_id}.tsv")


def pack_classifiers(rows: list[dict]) -> dict[tuple[str, str], list[str]]:
    """Classificateurs relus à la main des mots d'une liste, par (hanzi, pinyin)."""
    wanted = {(r["hanzi"], r["pinyin"]) for r in rows}
    return {
        (r["hanzi"], r["pinyin"]): r["classificateurs"].split()
        for r in read_tsv("classificateurs.tsv")
        if (r["hanzi"], r["pinyin"]) in wanted
    }


def dictionary_classifiers(hanzi: str) -> list[str]:
    try:
        return dictionary.classifiers_of(hanzi)
    except FileNotFoundError:
        return []


@router.get("/decks")
def list_decks():
    with pool.connection() as conn:
        return conn.execute(
            """SELECT d.id, d.name, d.description, count(dw.word_id) AS word_count
               FROM decks d LEFT JOIN deck_words dw ON dw.deck_id = d.id
               GROUP BY d.id ORDER BY d.name"""
        ).fetchall()


@router.post("/decks", status_code=201)
def create_deck(deck: DeckIn):
    try:
        with pool.connection() as conn:
            return conn.execute(
                """INSERT INTO decks (name, description) VALUES (%(name)s, %(description)s)
                   RETURNING id, name, description""",
                deck.model_dump(),
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Cette liste existe déjà")


@router.get("/words")
def list_words(deck_id: int | None = None):
    with pool.connection() as conn:
        return conn.execute(
            """SELECT w.id, w.hanzi, w.pinyin, w.translation, w.classifiers,
                      coalesce(array_agg(dw.deck_id) FILTER (WHERE dw.deck_id IS NOT NULL), '{}')
                          AS deck_ids
               FROM words w LEFT JOIN deck_words dw ON dw.word_id = w.id
               WHERE %(deck_id)s::int IS NULL OR EXISTS (
                   SELECT 1 FROM deck_words f WHERE f.word_id = w.id AND f.deck_id = %(deck_id)s)
               GROUP BY w.id ORDER BY w.id""",
            {"deck_id": deck_id},
        ).fetchall()


@router.post("/words", status_code=201)
def create_word(word: WordIn):
    params = word.model_dump()
    if word.classifiers is None:
        params["classifiers"] = dictionary_classifiers(word.hanzi)
    try:
        with pool.connection() as conn:
            created = conn.execute(
                """INSERT INTO words (hanzi, pinyin, translation, classifiers)
                   VALUES (%(hanzi)s, %(pinyin)s, %(translation)s, %(classifiers)s)
                   RETURNING id, hanzi, pinyin, translation, classifiers""",
                params,
            ).fetchone()
            created["deck_ids"] = []
            if word.deck_id is not None:
                conn.execute(
                    "INSERT INTO deck_words (deck_id, word_id) VALUES (%s, %s)",
                    (word.deck_id, created["id"]),
                )
                created["deck_ids"] = [word.deck_id]
            return created
    except UniqueViolation:
        raise HTTPException(409, "Ce mot existe déjà")
    except ForeignKeyViolation:
        raise HTTPException(400, "Liste inconnue")


@router.get("/words/{word_id}")
def get_word(word_id: int):
    with pool.connection() as conn:
        word = conn.execute(
            "SELECT id, hanzi, pinyin, translation, classifiers FROM words WHERE id = %s",
            (word_id,),
        ).fetchone()
        if word is None:
            raise HTTPException(404, "Mot introuvable")
        word["measure"] = classifiers.measure(word["hanzi"], word["pinyin"], word["classifiers"])
        word["deck_ids"] = [
            r["deck_id"] for r in conn.execute(
                "SELECT deck_id FROM deck_words WHERE word_id = %s", (word_id,))
        ]
        word["examples"] = conn.execute(
            """SELECT id, hanzi, pinyin, translation FROM examples
               WHERE word_id = %s ORDER BY id""",
            (word_id,),
        ).fetchall()
        return word


@router.put("/words/{word_id}/classifiers")
def set_classifiers(word_id: int, data: ClassifiersIn):
    """Remplace les classificateurs d'un mot (liste vide : aucun)."""
    with pool.connection() as conn:
        word = conn.execute(
            """UPDATE words SET classifiers = %s WHERE id = %s
               RETURNING id, hanzi, pinyin, classifiers""",
            (list(dict.fromkeys(data.classifiers)), word_id),
        ).fetchone()
    if word is None:
        raise HTTPException(404, "Mot introuvable")
    word["measure"] = classifiers.measure(word["hanzi"], word["pinyin"], word["classifiers"])
    return word


@router.post("/words/{word_id}/examples", status_code=201)
def create_example(word_id: int, example: ExampleIn):
    try:
        with pool.connection() as conn:
            return conn.execute(
                """INSERT INTO examples (word_id, hanzi, pinyin, translation)
                   VALUES (%(word_id)s, %(hanzi)s, %(pinyin)s, %(translation)s)
                   RETURNING id, hanzi, pinyin, translation""",
                {**example.model_dump(), "word_id": word_id},
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Cette phrase existe déjà pour ce mot")
    except ForeignKeyViolation:
        raise HTTPException(404, "Mot introuvable")


@router.delete("/examples/{example_id}", status_code=204)
def delete_example(example_id: int):
    with pool.connection() as conn:
        if conn.execute("DELETE FROM examples WHERE id = %s", (example_id,)).rowcount == 0:
            raise HTTPException(404, "Exemple introuvable")


@router.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: int):
    with pool.connection() as conn:
        if conn.execute("DELETE FROM words WHERE id = %s", (word_id,)).rowcount == 0:
            raise HTTPException(404, "Mot introuvable")


@router.get("/packs")
def list_packs():
    with pool.connection() as conn:
        decks = {
            r["name"]: r for r in conn.execute(
                """SELECT d.id, d.name, count(dw.word_id) AS word_count,
                          count(dw.word_id) FILTER (
                              WHERE EXISTS (SELECT 1 FROM examples e WHERE e.word_id = dw.word_id)
                          ) AS with_examples
                   FROM decks d LEFT JOIN deck_words dw ON dw.deck_id = d.id
                   GROUP BY d.id""")
        }
        without_classifiers = {
            (r["hanzi"], r["pinyin"]) for r in conn.execute(
                "SELECT hanzi, pinyin FROM words WHERE classifiers = '{}'")
        }
    packs = []
    for pack_id, (name, description) in PACKS.items():
        deck = decks.get(name)
        rows = read_pack(pack_id)
        packs.append({
            "id": pack_id,
            "name": name,
            "description": description,
            "word_count": len(rows),
            "deck_id": deck and deck["id"],
            "imported_count": deck["word_count"] if deck else 0,
            "example_count": len(read_tsv(f"{pack_id}_exemples.tsv")),
            "with_examples": deck["with_examples"] if deck else 0,
            # Mots déjà présents à qui il manque les classificateurs de la liste.
            "missing_classifiers": len(pack_classifiers(rows).keys() & without_classifiers),
        })
    return packs


@router.post("/packs/{pack_id}/import")
def import_pack(pack_id: str):
    """Importe une liste (idempotent) : crée la liste, ajoute les mots absents, rattache à la
    liste tous les mots du fichier, y compris ceux déjà présents (leur traduction est conservée),
    et ajoute les phrases d'exemple et les classificateurs manquants."""
    if pack_id not in PACKS:
        raise HTTPException(404, "Liste inconnue")
    name, description = PACKS[pack_id]
    rows = read_pack(pack_id)
    pinyin_of = {r["hanzi"]: r["pinyin"] for r in rows}
    examples = [e for e in read_tsv(f"{pack_id}_exemples.tsv") if e["hanzi"] in pinyin_of]
    params = {
        "name": name,
        "description": description,
        "hanzi": [r["hanzi"] for r in rows],
        "pinyin": [r["pinyin"] for r in rows],
        "translation": [r["traduction"] for r in rows],
    }
    with pool.connection() as conn:
        deck_id = conn.execute(
            """INSERT INTO decks (name, description) VALUES (%(name)s, %(description)s)
               ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
               RETURNING id""",
            params,
        ).fetchone()["id"]
        added = conn.execute(
            """INSERT INTO words (hanzi, pinyin, translation)
               SELECT * FROM unnest(%(hanzi)s::text[], %(pinyin)s::text[], %(translation)s::text[])
               ON CONFLICT (hanzi, pinyin) DO NOTHING""",
            params,
        ).rowcount
        conn.execute(
            """INSERT INTO deck_words (deck_id, word_id)
               SELECT %(deck_id)s, w.id
               FROM words w
               JOIN unnest(%(hanzi)s::text[], %(pinyin)s::text[]) AS p(hanzi, pinyin)
                 ON p.hanzi = w.hanzi AND p.pinyin = w.pinyin
               ON CONFLICT DO NOTHING""",
            {**params, "deck_id": deck_id},
        )
        added_examples = conn.execute(
            """INSERT INTO examples (word_id, hanzi, pinyin, translation)
               SELECT w.id, e.hanzi, e.pinyin, e.translation
               FROM unnest(%(word_hanzi)s::text[], %(word_pinyin)s::text[], %(ex_hanzi)s::text[],
                           %(ex_pinyin)s::text[], %(ex_translation)s::text[])
                    AS e(word_hanzi, word_pinyin, hanzi, pinyin, translation)
               JOIN words w ON w.hanzi = e.word_hanzi AND w.pinyin = e.word_pinyin
               ON CONFLICT (word_id, hanzi) DO NOTHING""",
            {
                "word_hanzi": [e["hanzi"] for e in examples],
                "word_pinyin": [pinyin_of[e["hanzi"]] for e in examples],
                "ex_hanzi": [e["phrase"] for e in examples],
                "ex_pinyin": [e["pinyin"] for e in examples],
                "ex_translation": [e["traduction"] for e in examples],
            },
        ).rowcount
        word_classifiers = pack_classifiers(rows)
        with conn.cursor() as cur:
            cur.executemany(
                """UPDATE words SET classifiers = %s
                   WHERE hanzi = %s AND pinyin = %s AND classifiers = '{}'""",
                [(found, hanzi, pinyin) for (hanzi, pinyin), found in word_classifiers.items()],
            )
    return {
        "deck_id": deck_id,
        "total": len(rows),
        "added": added,
        "added_examples": added_examples,
    }
