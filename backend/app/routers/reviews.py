from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import pool
from ..srs import CardState, due_date, schedule
from .exercises import Mode, card_payload

router = APIRouter(prefix="/api/reviews", tags=["révisions"])


class ReviewIn(BaseModel):
    word_id: int
    mode: Mode
    grade: int = Field(ge=1, le=4)


@router.post("")
def submit_review(review: ReviewIn):
    """Enregistre une réponse et reprogramme la carte. Renvoie la carte mise à jour."""
    params = review.model_dump()
    with pool.connection() as conn:
        row = conn.execute(
            """SELECT w.id AS word_id, %(mode)s::text AS mode, w.hanzi, w.pinyin, w.translation,
                      w.classifiers,
                      rs.ease, rs.interval_days, rs.repetitions, rs.lapses
               FROM words w
               LEFT JOIN review_states rs ON rs.word_id = w.id AND rs.mode = %(mode)s
               WHERE w.id = %(word_id)s
               FOR UPDATE OF w""",
            params,
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Mot introuvable")

        state, delay = schedule(CardState.from_row(row), review.grade)
        now = datetime.now(timezone.utc)
        params |= {
            "ease": state.ease,
            "interval_days": state.interval_days,
            "repetitions": state.repetitions,
            "lapses": state.lapses,
            "due_at": due_date(now, delay),
            "now": now,
        }
        conn.execute(
            """INSERT INTO review_states (word_id, mode, ease, interval_days, repetitions,
                                          lapses, due_at, first_reviewed_at, last_reviewed_at)
               VALUES (%(word_id)s, %(mode)s, %(ease)s, %(interval_days)s, %(repetitions)s,
                       %(lapses)s, %(due_at)s, %(now)s, %(now)s)
               ON CONFLICT (word_id, mode) DO UPDATE SET
                   ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days,
                   repetitions = EXCLUDED.repetitions, lapses = EXCLUDED.lapses,
                   due_at = EXCLUDED.due_at, last_reviewed_at = EXCLUDED.last_reviewed_at""",
            params,
        )
        conn.execute(
            """INSERT INTO review_log (word_id, mode, grade, ease, interval_days, reviewed_at)
               VALUES (%(word_id)s, %(mode)s, %(grade)s, %(ease)s, %(interval_days)s, %(now)s)""",
            params,
        )

    card = card_payload({**row, **params})
    card["due_at"] = params["due_at"]
    return card
