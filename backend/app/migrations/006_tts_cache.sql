-- Audio généré par la synthèse vocale, gardé pour ne le calculer qu'une fois.
-- `voice` change quand le modèle change, ce qui invalide l'ancien audio.
CREATE TABLE tts_cache (
    voice      TEXT NOT NULL,
    text       TEXT NOT NULL,
    reading    TEXT NOT NULL DEFAULT '',
    audio      BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (voice, text, reading)
);
