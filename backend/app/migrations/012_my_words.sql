-- Mes mots : chaque élève peut garder des mots du vocabulaire dans un exercice personnel (révisé
-- et testé comme les autres, repris par le fil), et noter son moyen mnémotechnique sur un mot.

ALTER TABLE exercises ADD COLUMN personal BOOLEAN NOT NULL DEFAULT false;
-- Un seul exercice personnel par compte.
CREATE UNIQUE INDEX exercises_one_personal ON exercises (owner_id) WHERE personal;

-- Date d'ajout d'un mot à un exercice (Mes mots : les plus récents d'abord).
ALTER TABLE exercise_words ADD COLUMN added_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE word_notes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    note       TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, word_id)
);
