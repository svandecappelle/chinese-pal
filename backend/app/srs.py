"""Répétition espacée : variante de SM-2 à 4 boutons (comme Anki).

Notes : 1 = à revoir, 2 = difficile, 3 = bien, 4 = facile.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4
GRADES = (AGAIN, HARD, GOOD, EASY)

MIN_EASE = 1.3
RELEARN_DELAY = timedelta(minutes=1)


@dataclass
class CardState:
    ease: float = 2.5
    interval_days: float = 0.0
    repetitions: int = 0
    lapses: int = 0

    @classmethod
    def from_row(cls, row: dict) -> "CardState":
        if row.get("ease") is None:
            return cls()
        return cls(row["ease"], row["interval_days"], row["repetitions"], row["lapses"])


def schedule(state: CardState, grade: int) -> tuple[CardState, timedelta]:
    """Renvoie le nouvel état de la carte et le délai avant la prochaine révision."""
    if grade == AGAIN:
        lapses = state.lapses + (1 if state.repetitions > 0 else 0)
        return CardState(max(MIN_EASE, state.ease - 0.2), 0.0, 0, lapses), RELEARN_DELAY

    if state.repetitions == 0:
        interval = {HARD: 1, GOOD: 1, EASY: 4}[grade]
    elif state.repetitions == 1:
        interval = {HARD: 3, GOOD: 6, EASY: 8}[grade]
    else:
        base = state.interval_days
        interval = {
            HARD: base * 1.2,
            GOOD: base * state.ease,
            EASY: base * state.ease * 1.3,
        }[grade]
        # Une réussite fait toujours progresser d'au moins un jour.
        interval = max(interval, base + 1)

    interval = round(interval)
    ease = max(MIN_EASE, state.ease + {HARD: -0.15, GOOD: 0.0, EASY: 0.15}[grade])
    return CardState(ease, interval, state.repetitions + 1, state.lapses), timedelta(days=interval)


def due_date(now: datetime, delay: timedelta) -> datetime:
    """Les cartes programmées à plusieurs jours deviennent dues dès le début du jour cible (UTC)."""
    due = now + delay
    if delay >= timedelta(days=1):
        due = due.replace(hour=0, minute=0, second=0, microsecond=0)
    return due


def format_delay(delay: timedelta) -> str:
    minutes = delay.total_seconds() / 60
    if minutes < 60:
        return f"{round(minutes)} min"
    days = minutes / 1440
    if days < 1:
        return f"{round(minutes / 60)} h"
    if days < 30:
        return f"{round(days)} j"
    if days < 365:
        return f"{round(days / 30, 1):g} mois"
    return f"{round(days / 365, 1):g} an"


def previews(state: CardState) -> dict[int, str]:
    """Délai affiché sous chaque bouton de réponse."""
    return {grade: format_delay(schedule(state, grade)[1]) for grade in GRADES}
