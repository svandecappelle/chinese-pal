-- Fil de révision : de petits pas chaque jour (une poignée de cartes chacun).
-- Rythme choisi par l'élève (pas par jour) et pas terminés (pour le fil et l'objectif du jour).

ALTER TABLE users ADD COLUMN daily_steps SMALLINT NOT NULL DEFAULT 3
    CHECK (daily_steps BETWEEN 1 AND 10);

CREATE TABLE feed_steps (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('due', 'missed', 'new')),
    answers     INTEGER NOT NULL DEFAULT 0,
    good        INTEGER NOT NULL DEFAULT 0,
    done_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feed_steps_user_done ON feed_steps (user_id, done_at);
