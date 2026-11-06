-- Répétition espacée (SM-2) et exercices personnalisés.
--
-- Une "carte" = un mot + un sens de révision. L'état de révision est global à la carte :
-- il est partagé entre tous les exercices qui la contiennent.

CREATE TABLE review_states (
    word_id           INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    direction         TEXT NOT NULL CHECK (direction IN ('hanzi_to_meaning', 'meaning_to_hanzi')),
    ease              REAL NOT NULL DEFAULT 2.5,
    interval_days     REAL NOT NULL DEFAULT 0,
    repetitions       INTEGER NOT NULL DEFAULT 0,
    lapses            INTEGER NOT NULL DEFAULT 0,
    due_at            TIMESTAMPTZ NOT NULL,
    first_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (word_id, direction)
);

CREATE INDEX review_states_due_at_idx ON review_states (due_at);

-- Historique de chaque réponse (statistiques, futur réglage de l'algorithme).
CREATE TABLE review_log (
    id            BIGSERIAL PRIMARY KEY,
    word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    direction     TEXT NOT NULL,
    grade         SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 4),
    ease          REAL NOT NULL,
    interval_days REAL NOT NULL,
    reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_log_reviewed_at_idx ON review_log (reviewed_at);

-- Un exercice = un ensemble de mots (tout le vocabulaire, des listes et/ou des mots choisis)
-- et un sens de révision.
CREATE TABLE exercises (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    direction   TEXT NOT NULL DEFAULT 'hanzi_to_meaning'
                CHECK (direction IN ('hanzi_to_meaning', 'meaning_to_hanzi', 'both')),
    new_per_day INTEGER NOT NULL DEFAULT 10 CHECK (new_per_day >= 0),
    all_words   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exercise_decks (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    deck_id     INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, deck_id)
);

CREATE TABLE exercise_words (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, word_id)
);

INSERT INTO exercises (name, description, direction, new_per_day, all_words)
VALUES ('Tout le vocabulaire', 'Révision quotidienne de tous les mots', 'both', 10, true);
