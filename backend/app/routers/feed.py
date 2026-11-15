"""Fil de révision : chaque jour quelques petits pas, puis l'historique de ce qui a été fait.

Un pas est un mini-test d'une poignée de cartes d'un seul exercice et d'une seule sorte : cartes
à revoir, cartes ratées ces derniers jours (reprises en avance) ou nouvelles cartes. L'élève
choisit son rythme (pas par jour) ; un pas compte quand son test va jusqu'au bout. Les jours sont
comptés en UTC, comme les statistiques.
"""

from datetime import datetime, time, timedelta, timezone
from math import ceil
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import auth
from ..db import pool
from .exercises import CARDS_CTE, EXERCISES_SQL, MISSED_WHERE, exercise_stats, user_params
from .stats import MASTERED_DAYS, my_stats

router = APIRouter(prefix="/api/feed", tags=["fil de révision"])

STEP_CARDS = 8
SECONDS_PER_CARD = 20
FEED_DAYS = 7
# Deux réponses à plus d'une demi-heure d'écart : deux séances distinctes dans le fil.
SITTING_GAP = timedelta(minutes=30)
GRADES_SHOWN = 40
PREVIEW_WORDS = 6
# Cartes à revoir regardées par exercice pour prévoir les pas (il n'en faut que quelques-unes).
MAX_PLANNED = 200

Kind = Literal["due", "missed", "new"]

# Cartes d'un pas, dans l'ordre où le test (GET /exercises/{id}/session?only=…) les prendra.
STEP_CARDS_SQL = {
    "due": "SELECT * FROM cards WHERE due_at <= now() ORDER BY due_at",
    "missed": MISSED_WHERE + " ORDER BY due_at",
    "new": "SELECT * FROM cards WHERE due_at IS NULL ORDER BY mode_position, word_id",
}


def minutes(cards: int) -> int:
    return max(1, ceil(cards * SECONDS_PER_CARD / 60))


def plan_steps(conn, user: dict, wanted: int) -> list[dict]:
    """Les `wanted` prochains pas : d'abord les cartes à revoir (les exercices les plus en retard
    d'abord), puis un pas de cartes ratées, puis les nouvelles cartes du jour. Une carte présente
    dans plusieurs exercices (« Tout le vocabulaire ») ne compte qu'une fois."""
    exercises = conn.execute(
        f"SELECT * FROM ({EXERCISES_SQL}) e WHERE assigned ORDER BY all_words, name",
        user_params(user),
    ).fetchall()
    infos = [(exercise, exercise_stats(conn, exercise, user["id"])) for exercise in exercises]
    claimed: set = set()
    batches: list = []

    def cards(kind: str, exercise: dict, limit: int) -> list[dict]:
        """Cartes d'une sorte, dans l'ordre du test, sans celles déjà prévues ailleurs."""
        if limit <= 0:
            return []
        rows = conn.execute(
            CARDS_CTE + f"SELECT word_id, mode, hanzi FROM ({STEP_CARDS_SQL[kind]} LIMIT %(limit)s) b",
            {"user_id": user["id"], "exercise_id": exercise["id"], "limit": limit},
        ).fetchall()
        free = [r for r in rows if (r["word_id"], r["mode"]) not in claimed]
        claimed.update((r["word_id"], r["mode"]) for r in free)
        return free

    def add(kind: str, exercise: dict, rows: list[dict]) -> None:
        for start in range(0, len(rows), STEP_CARDS):
            if len(batches) < wanted:
                batches.append((kind, exercise, rows[start:start + STEP_CARDS]))

    for exercise, stats in sorted(infos, key=lambda info: -info[1]["due"]):
        if len(batches) < wanted:
            add("due", exercise, cards("due", exercise, min(stats["due"], MAX_PLANNED)))
    if len(batches) < wanted:
        missed = max(((exercise, cards("missed", exercise, STEP_CARDS)) for exercise, _ in infos),
                     key=lambda item: len(item[1]), default=(None, []))
        if missed[1]:
            add("missed", *missed)
    for exercise, stats in infos:
        if len(batches) < wanted:
            add("new", exercise, cards("new", exercise, stats["new_today"]))

    steps = []
    for kind, exercise, rows in batches:
        words = list(dict.fromkeys(r["hanzi"] for r in rows))
        steps.append({
            "kind": kind,
            "exercise_id": exercise["id"],
            "exercise_name": exercise["name"],
            "cards": len(rows),
            "minutes": minutes(len(rows)),
            "words": words[:PREVIEW_WORDS],
            "more_words": max(0, len(words) - PREVIEW_WORDS),
            "modes": list(dict.fromkeys(r["mode"] for r in rows)),
        })
    return steps


def sittings(log: list[dict], steps: list[dict]) -> list[dict]:
    """Réponses regroupées en séances (pause de plus d'une demi-heure entre deux séances)."""
    groups = []
    for row in log:
        if groups and row["reviewed_at"] - groups[-1][-1]["reviewed_at"] <= SITTING_GAP:
            groups[-1].append(row)
        else:
            groups.append([row])
    events = []
    for rows in groups:
        start, end = rows[0]["reviewed_at"], rows[-1]["reviewed_at"]
        done = [s for s in steps if start <= s["done_at"] <= end + SITTING_GAP]
        events.append({
            "type": "sitting",
            "at": start,
            "end": end,
            "answers": len(rows),
            "good": sum(1 for r in rows if r["grade"] >= 3),
            "grades": [r["grade"] for r in rows[:GRADES_SHOWN]],
            "steps": len(done),
        })
    return events


def feed_events(conn, user: dict, since: datetime, pace: int, stats: dict) -> list[dict]:
    params = {"user_id": user["id"], "since": since, "mastered": MASTERED_DAYS}
    log = conn.execute(
        """SELECT reviewed_at, grade FROM review_log
           WHERE user_id = %(user_id)s AND reviewed_at >= %(since)s ORDER BY reviewed_at""",
        params).fetchall()
    steps = conn.execute(
        """SELECT done_at FROM feed_steps
           WHERE user_id = %(user_id)s AND done_at >= %(since)s ORDER BY done_at""",
        params).fetchall()
    events = sittings(log, steps)

    # Objectif du jour atteint : le pas qui complète le rythme choisi.
    by_day: dict = {}
    for step in steps:
        by_day.setdefault(step["done_at"].astimezone(timezone.utc).date(), []).append(step)
    for day_steps in by_day.values():
        if len(day_steps) >= pace:
            events.append({"type": "goal", "at": day_steps[pace - 1]["done_at"], "steps": len(day_steps),
                           "pace": pace})

    # Mots maîtrisés : une de leurs cartes vient de passer à trois semaines ou plus, et toutes
    # y sont maintenant.
    for word in conn.execute(
        """SELECT w.id AS word_id, w.hanzi, w.pinyin, w.translation, max(x.reviewed_at) AS at
           FROM (SELECT word_id, reviewed_at, interval_days,
                        lag(interval_days) OVER (PARTITION BY word_id, mode ORDER BY reviewed_at)
                            AS previous
                 FROM review_log
                 WHERE user_id = %(user_id)s AND word_id IN (
                     SELECT word_id FROM review_log
                     WHERE user_id = %(user_id)s AND reviewed_at >= %(since)s
                       AND interval_days >= %(mastered)s)) x
           JOIN words w ON w.id = x.word_id
           WHERE x.reviewed_at >= %(since)s AND x.interval_days >= %(mastered)s
             AND COALESCE(x.previous, 0) < %(mastered)s
             AND (SELECT min(interval_days) FROM review_states rs
                  WHERE rs.user_id = %(user_id)s AND rs.word_id = w.id) >= %(mastered)s
           GROUP BY w.id ORDER BY at DESC LIMIT 20""",
        params,
    ):
        events.append({"type": "mastered", **word})

    # Mots découverts (première réponse), un événement par jour.
    discovered: dict = {}
    for word in conn.execute(
        """SELECT w.hanzi, min(rs.first_reviewed_at) AS at
           FROM review_states rs JOIN words w ON w.id = rs.word_id
           WHERE rs.user_id = %(user_id)s
           GROUP BY w.id HAVING min(rs.first_reviewed_at) >= %(since)s ORDER BY at""",
        params,
    ):
        day = discovered.setdefault(word["at"].astimezone(timezone.utc).date(), {"words": [], "at": None})
        day["words"].append(word["hanzi"])
        day["at"] = word["at"]
    for day in discovered.values():
        events.append({"type": "discovered", "at": day["at"], "count": len(day["words"]),
                       "words": day["words"][:8]})

    # Série en cours, rattachée à la dernière réponse.
    if stats.get("streak", 0) >= 2 and log:
        events.append({"type": "streak", "at": log[-1]["reviewed_at"], "streak": stats["streak"],
                       "best": stats["best_streak"]})

    # Nouveaux exercices attribués par un professeur (pas ceux que l'on a créés soi-même).
    for exercise in conn.execute(
        f"""SELECT * FROM ({EXERCISES_SQL}) e
            WHERE assigned AND created_at >= %(since)s AND owner_id IS DISTINCT FROM %(user_id)s
            ORDER BY created_at""",
        user_params(user) | {"since": since},
    ):
        events.append({"type": "exercise", "at": exercise["created_at"], "exercise_id": exercise["id"],
                       "name": exercise["name"],
                       "unseen": exercise_stats(conn, exercise, user["id"])["unseen"]})

    events.sort(key=lambda e: e["at"], reverse=True)
    return events


@router.get("")
def get_feed(user: dict = Depends(auth.current_user)):
    stats = my_stats(user)
    today = stats["today"]
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    week_start = today - timedelta(days=today.weekday())
    with pool.connection() as conn:
        pace = conn.execute("SELECT daily_steps FROM users WHERE id = %s", (user["id"],)).fetchone()["daily_steps"]
        done = conn.execute(
            """SELECT f.kind, f.exercise_id, e.name AS exercise_name, f.answers, f.good, f.done_at
               FROM feed_steps f LEFT JOIN exercises e ON e.id = f.exercise_id
               WHERE f.user_id = %s AND f.done_at >= %s ORDER BY f.done_at""",
            (user["id"], today_start)).fetchall()
        # Toujours au moins un pas proposé : une fois l'objectif atteint, « un pas de plus ».
        upcoming = plan_steps(conn, user, max(1, pace - len(done)))
        week_steps = {
            r["day"]: r["n"] for r in conn.execute(
                """SELECT (done_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n FROM feed_steps
                   WHERE user_id = %s AND done_at >= %s GROUP BY day""",
                (user["id"], datetime.combine(week_start, time.min, tzinfo=timezone.utc)))
        }
        tomorrow = conn.execute(
            """SELECT count(*) AS n FROM review_states
               WHERE user_id = %s AND due_at >= %s AND due_at < %s""",
            (user["id"], today_start + timedelta(days=1), today_start + timedelta(days=2)),
        ).fetchone()["n"]
        events = feed_events(conn, user, today_start - timedelta(days=FEED_DAYS - 1), pace, stats)
        my_words = conn.execute(
            """SELECT count(*) AS n FROM exercise_words ew JOIN exercises e ON e.id = ew.exercise_id
               WHERE e.owner_id = %s AND e.personal""", (user["id"],)).fetchone()["n"]

    answers_by_day = {d["day"]: d["answers"] for d in stats.get("calendar", [])}
    week = []
    for i in range(7):
        day = week_start + timedelta(days=i)
        week.append({"day": day, "answers": answers_by_day.get(day, 0), "steps": week_steps.get(day, 0)})
    return {
        "today": today,
        "pace": pace,
        "step_cards": STEP_CARDS,
        "done": done,
        "upcoming": upcoming,
        "week": week,
        "streak": stats.get("streak", 0),
        "best_streak": stats.get("best_streak", 0),
        "tomorrow": {"cards": tomorrow, "minutes": minutes(tomorrow) if tomorrow else 0,
                     "steps": ceil(tomorrow / STEP_CARDS)},
        "progress": {k: stats.get(k) for k in ("words_seen", "words_mastered", "success_month",
                                               "days_active", "answers")},
        "events": events,
        "my_words": my_words,
    }


class PaceIn(BaseModel):
    steps: int = Field(ge=1, le=10)


@router.put("/pace")
def set_pace(data: PaceIn, user: dict = Depends(auth.current_user)):
    """Rythme : nombre de pas par jour."""
    with pool.connection() as conn:
        conn.execute("UPDATE users SET daily_steps = %s WHERE id = %s", (data.steps, user["id"]))
    return {"pace": data.steps}


class StepIn(BaseModel):
    exercise_id: int | None = None
    kind: Kind
    answers: int = Field(0, ge=0, le=1000)
    good: int = Field(0, ge=0, le=1000)


@router.post("/steps", status_code=201)
def finish_step(data: StepIn, user: dict = Depends(auth.current_user)):
    """Un pas du fil terminé (son test est allé jusqu'au bout)."""
    with pool.connection() as conn:
        exercise_id = data.exercise_id
        if exercise_id is not None and conn.execute(
                "SELECT 1 FROM exercises WHERE id = %s", (exercise_id,)).fetchone() is None:
            exercise_id = None
        row = conn.execute(
            """INSERT INTO feed_steps (user_id, exercise_id, kind, answers, good)
               VALUES (%s, %s, %s, %s, %s) RETURNING id, done_at""",
            (user["id"], exercise_id, data.kind, data.answers, min(data.good, data.answers)),
        ).fetchone()
    return row
