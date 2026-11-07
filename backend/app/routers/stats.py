"""Statistiques personnelles : série de jours, calendrier, réussite par mode, mots les plus ratés.

Valent pour un compte comme pour un invité (progression gardée dans le navigateur). Les jours
sont comptés en UTC, comme la limite de nouvelles cartes.
"""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import auth
from ..db import pool
from .exercises import study_words

router = APIRouter(prefix="/api/stats", tags=["statistiques"])

CALENDAR_DAYS = 7 * 53
# Une carte est « maîtrisée » quand elle ne revient qu'après trois semaines ou plus.
MASTERED_DAYS = 21
DIFFICULT_DAYS = 90
DIFFICULT_LIMIT = 20

# Mots ratés (note 1) ces derniers jours, les plus ratés d'abord.
DIFFICULT_SQL = """
SELECT w.id AS word_id, w.hanzi, w.pinyin, w.translation, w.classifiers,
       count(*) FILTER (WHERE l.grade = 1) AS misses, count(*) AS answers,
       array_agg(DISTINCT l.mode) FILTER (WHERE l.grade = 1) AS modes
FROM review_log l JOIN words w ON w.id = l.word_id
WHERE l.user_id = %(user_id)s AND l.reviewed_at > now() - make_interval(days => %(days)s)
GROUP BY w.id
HAVING count(*) FILTER (WHERE l.grade = 1) > 0
ORDER BY count(*) FILTER (WHERE l.grade = 1) DESC,
         count(*) FILTER (WHERE l.grade = 1)::real / count(*) DESC, w.id
LIMIT %(limit)s
"""


def streaks(days: list[date], today: date) -> tuple[int, int]:
    """(série en cours, meilleure série) de jours d'affilée avec au moins une réponse.
    La série en cours tient encore si le dernier jour révisé est hier."""
    best = run = 0
    previous = None
    for day in days:
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    current = run if previous is not None and today - previous <= timedelta(days=1) else 0
    return current, best


def require_learner(user: dict | None) -> dict:
    if user is None:
        raise HTTPException(404, "Aucune révision pour le moment")
    return user


@router.get("")
def my_stats(user: dict | None = Depends(auth.visitor)):
    today = datetime.now(timezone.utc).date()
    if user is None:
        return {"empty": True, "today": today}
    params = {"user_id": user["id"], "calendar": CALENDAR_DAYS, "mastered": MASTERED_DAYS,
              "days": DIFFICULT_DAYS, "limit": DIFFICULT_LIMIT}
    with pool.connection() as conn:
        days = [r["day"] for r in conn.execute(
            """SELECT DISTINCT (reviewed_at AT TIME ZONE 'UTC')::date AS day
               FROM review_log WHERE user_id = %(user_id)s ORDER BY day""", params)]
        calendar = conn.execute(
            """SELECT (reviewed_at AT TIME ZONE 'UTC')::date AS day, count(*) AS answers,
                      count(*) FILTER (WHERE grade >= 3) AS good
               FROM review_log
               WHERE user_id = %(user_id)s
                 AND reviewed_at >= (now() AT TIME ZONE 'UTC')::date - %(calendar)s
               GROUP BY day ORDER BY day""", params).fetchall()
        totals = conn.execute(
            """SELECT count(*) AS answers,
                      count(*) FILTER (WHERE reviewed_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                                                            AT TIME ZONE 'UTC') AS today,
                      count(*) FILTER (WHERE reviewed_at > now() - interval '30 days') AS month,
                      count(*) FILTER (WHERE reviewed_at > now() - interval '30 days' AND grade >= 3)
                          AS month_good
               FROM review_log WHERE user_id = %(user_id)s""", params).fetchone()
        words = conn.execute(
            """SELECT count(*) AS seen,
                      count(*) FILTER (WHERE shortest >= %(mastered)s) AS mastered
               FROM (SELECT word_id, min(interval_days) AS shortest FROM review_states
                     WHERE user_id = %(user_id)s GROUP BY word_id) AS w""", params).fetchone()
        modes = conn.execute(
            """SELECT mode, count(*) AS answers, count(*) FILTER (WHERE grade >= 3) AS good
               FROM review_log
               WHERE user_id = %(user_id)s AND reviewed_at > now() - interval '30 days'
               GROUP BY mode ORDER BY count(*) DESC""", params).fetchall()
        due = conn.execute(
            "SELECT count(*) AS n FROM review_states WHERE user_id = %(user_id)s AND due_at <= now()",
            params).fetchone()["n"]
        difficult = conn.execute(DIFFICULT_SQL, params).fetchall()
    current, best = streaks(days, today)
    return {
        "empty": not totals["answers"],
        "today": today,
        "streak": current,
        "best_streak": best,
        "reviewed_today": bool(days) and days[-1] == today,
        "days_active": len(days),
        "answers": totals["answers"],
        "answers_today": totals["today"],
        "answers_month": totals["month"],
        "success_month": totals["month_good"] / totals["month"] if totals["month"] else None,
        "words_seen": words["seen"],
        "words_mastered": words["mastered"],
        "due": due,
        "calendar": calendar,
        "modes": modes,
        "difficult": [
            {k: r[k] for k in ("word_id", "hanzi", "pinyin", "translation", "misses", "answers", "modes")}
            for r in difficult
        ],
    }


@router.get("/difficult-words")
def difficult_words(user: dict | None = Depends(auth.visitor)):
    """Les mots les plus ratés, au format du mode révision (pour les retravailler)."""
    user = require_learner(user)
    with pool.connection() as conn:
        rows = conn.execute(DIFFICULT_SQL, {"user_id": user["id"], "days": DIFFICULT_DAYS,
                                            "limit": DIFFICULT_LIMIT}).fetchall()
        return {
            "exercise": {"id": None, "name": "Mes mots les plus ratés"},
            "words": study_words(conn, rows),
        }


@router.post("/difficult-words/due")
def make_difficult_due(user: dict | None = Depends(auth.visitor)):
    """Remet les mots les plus ratés « à revoir » tout de suite : ils reviennent dans les tests
    des exercices qui les contiennent (seulement les modes où ils ont été ratés)."""
    user = require_learner(user)
    with pool.connection() as conn:
        rows = conn.execute(DIFFICULT_SQL, {"user_id": user["id"], "days": DIFFICULT_DAYS,
                                            "limit": DIFFICULT_LIMIT}).fetchall()
        updated = 0
        for row in rows:
            updated += conn.execute(
                """UPDATE review_states SET due_at = now()
                   WHERE user_id = %s AND word_id = %s AND mode = ANY(%s) AND due_at > now()""",
                (user["id"], row["word_id"], row["modes"]),
            ).rowcount
    return {"cards": updated}
