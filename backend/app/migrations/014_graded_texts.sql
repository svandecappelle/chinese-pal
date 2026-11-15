-- Textes gradués en base : modifiables et masquables par les professeurs et administrateurs.
-- Les textes fournis (data/textes.json) y sont chargés au démarrage (builtin_id) sans écraser
-- les modifications ; un professeur peut aussi en écrire de nouveaux (builtin_id nul).
CREATE TABLE graded_texts (
    id          SERIAL PRIMARY KEY,
    builtin_id  INTEGER UNIQUE,
    level       SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 9),
    title       TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 60),
    title_fr    TEXT NOT NULL DEFAULT '' CHECK (length(title_fr) <= 120),
    text        TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 3000),
    translation TEXT NOT NULL DEFAULT '' CHECK (length(translation) <= 6000),
    hidden      BOOLEAN NOT NULL DEFAULT false,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
