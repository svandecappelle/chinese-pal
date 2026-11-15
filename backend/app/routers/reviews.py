from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth
from ..db import pool
from ..srs import CardState, due_date, schedule
from .exercises import Mode, card_payload

router = APIRouter(prefix="/api/reviews", tags=["révisions"])


class ReviewIn(BaseModel):
    word_id: int
    mode: Mode
    grade: int = Field(ge=1, le=4)
    # Moment de la réponse, pour une réponse donnée hors ligne et envoyée plus tard.
    answered_at: datetime | None = None


# Une réponse hors ligne plus ancienne compte à cette date au plus tôt.
OFFLINE_MAX_AGE = timedelta(days=30)


def answer_time(answered_at: datetime | None, last_reviewed_at: datetime | None) -> datetime:
    """Moment retenu pour une réponse : maintenant, ou celui de la réponse hors ligne, borné
    (jamais dans le futur, ni avant la réponse précédente sur cette carte, ni il y a plus de
    30 jours)."""
    now = datetime.now(timezone.utc)
    if answered_at is None:
        return now
    if answered_at.tzinfo is None:
        answered_at = answered_at.replace(tzinfo=timezone.utc)
    when = max(min(answered_at, now), now - OFFLINE_MAX_AGE)
    if last_reviewed_at is not None:
        when = max(when, min(last_reviewed_at, now))
    return when


# Le mot appartient-il (dans ce mode) à un exercice public ?
PUBLIC_WORD_SQL = """
SELECT 1 FROM exercises e
WHERE e.public AND %(mode)s = ANY(e.modes) AND (
    e.all_words
    OR EXISTS (SELECT 1 FROM exercise_words ew WHERE ew.exercise_id = e.id AND ew.word_id = %(word_id)s)
    OR EXISTS (SELECT 1 FROM exercise_decks ed JOIN deck_words dw ON dw.deck_id = ed.deck_id
               WHERE ed.exercise_id = e.id AND dw.word_id = %(word_id)s))
LIMIT 1
"""


@router.post("")
def submit_review(review: ReviewIn, request: Request, response: Response,
                  user: dict | None = Depends(auth.visitor)):
    """Enregistre une réponse et reprogramme la carte. Renvoie la carte mise à jour.

    Sans compte, seuls les mots d'un exercice public se révisent ; la première réponse crée
    un compte invité (cookie) qui garde la progression dans ce navigateur.
    """
    with pool.connection() as conn:
        if user is None or user["is_guest"]:
            allowed = conn.execute(PUBLIC_WORD_SQL, review.model_dump(include={"word_id", "mode"})).fetchone()
            if allowed is None:
                raise HTTPException(401, "Connecte-toi pour réviser ce mot")
            if user is None:
                user = auth.create_guest(conn, request, response)
        params = review.model_dump(exclude={"answered_at"}) | {"user_id": user["id"]}
        row = conn.execute(
            """SELECT w.id AS word_id, %(mode)s::text AS mode, w.hanzi, w.pinyin, w.translation,
                      w.classifiers,
                      rs.ease, rs.interval_days, rs.repetitions, rs.lapses, rs.last_reviewed_at
               FROM words w
               LEFT JOIN review_states rs
                   ON rs.user_id = %(user_id)s AND rs.word_id = w.id AND rs.mode = %(mode)s
               WHERE w.id = %(word_id)s
               FOR UPDATE OF w""",
            params,
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Mot introuvable")

        state, delay = schedule(CardState.from_row(row), review.grade)
        # Réponse hors ligne : la carte est reprogrammée et notée à l'heure de la réponse.
        now = answer_time(review.answered_at, row["last_reviewed_at"])
        params |= {
            "ease": state.ease,
            "interval_days": state.interval_days,
            "repetitions": state.repetitions,
            "lapses": state.lapses,
            "due_at": due_date(now, delay),
            "now": now,
        }
        conn.execute(
            """INSERT INTO review_states (user_id, word_id, mode, ease, interval_days, repetitions,
                                          lapses, due_at, first_reviewed_at, last_reviewed_at)
               VALUES (%(user_id)s, %(word_id)s, %(mode)s, %(ease)s, %(interval_days)s,
                       %(repetitions)s, %(lapses)s, %(due_at)s, %(now)s, %(now)s)
               ON CONFLICT (user_id, word_id, mode) DO UPDATE SET
                   ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days,
                   repetitions = EXCLUDED.repetitions, lapses = EXCLUDED.lapses,
                   due_at = EXCLUDED.due_at, last_reviewed_at = EXCLUDED.last_reviewed_at""",
            params,
        )
        conn.execute(
            """INSERT INTO review_log (user_id, word_id, mode, grade, ease, interval_days,
                                        reviewed_at)
               VALUES (%(user_id)s, %(word_id)s, %(mode)s, %(grade)s, %(ease)s, %(interval_days)s, %(now)s)""",
            params,
        )

    card = card_payload({**row, **params})
    card["due_at"] = params["due_at"]
    return card
