-- Classificateurs des mots (一本书 : 本), et mode de révision « nom → classificateur ».

ALTER TABLE words ADD COLUMN classifiers TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE review_states DROP CONSTRAINT review_states_mode_check;
ALTER TABLE review_states ADD CONSTRAINT review_states_mode_check CHECK (
    mode IN ('hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning', 'meaning_to_hanzi',
             'hanzi_to_pinyin', 'meaning_to_pinyin', 'classifier')
);

ALTER TABLE exercises DROP CONSTRAINT exercises_modes_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_modes_check CHECK (
    cardinality(modes) > 0
    AND modes <@ ARRAY['hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning',
                       'meaning_to_hanzi', 'hanzi_to_pinyin', 'meaning_to_pinyin', 'classifier']
);
