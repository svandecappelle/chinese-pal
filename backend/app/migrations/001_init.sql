-- Schéma initial : listes de vocabulaire et mots.
-- Le modèle de révision (répétition espacée, progression...) viendra dans une migration suivante.

CREATE TABLE decks (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE words (
    id          SERIAL PRIMARY KEY,
    deck_id     INTEGER REFERENCES decks(id) ON DELETE SET NULL,
    hanzi       TEXT NOT NULL,
    pinyin      TEXT NOT NULL,
    translation TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hanzi, pinyin)
);

CREATE INDEX words_deck_id_idx ON words (deck_id);

-- Quelques mots d'exemple pour valider la chaîne de bout en bout.
INSERT INTO decks (name, description) VALUES ('Démo', 'Mots d''exemple');
INSERT INTO words (deck_id, hanzi, pinyin, translation) VALUES
    (1, '你好', 'nǐ hǎo', 'bonjour'),
    (1, '谢谢', 'xièxie', 'merci'),
    (1, '再见', 'zàijiàn', 'au revoir');
