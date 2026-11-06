-- Phrases d'exemple par mot, et mode de révision « écoute → sens » (audio_to_meaning).

CREATE TABLE examples (
    id          SERIAL PRIMARY KEY,
    word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    hanzi       TEXT NOT NULL,
    pinyin      TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (word_id, hanzi)
);

ALTER TABLE review_states DROP CONSTRAINT review_states_mode_check;
ALTER TABLE review_states ADD CONSTRAINT review_states_mode_check CHECK (
    mode IN ('hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning', 'meaning_to_hanzi',
             'hanzi_to_pinyin', 'meaning_to_pinyin')
);

ALTER TABLE exercises DROP CONSTRAINT exercises_modes_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_modes_check CHECK (
    cardinality(modes) > 0
    AND modes <@ ARRAY['hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning',
                       'meaning_to_hanzi', 'hanzi_to_pinyin', 'meaning_to_pinyin']
);
