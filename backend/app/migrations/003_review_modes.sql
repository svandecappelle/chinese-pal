-- Modes de révision : un exercice peut combiner plusieurs modes (au lieu d'un seul "sens").
--   hanzi_to_meaning   汉字 → sens            (auto-évaluation)
--   meaning_to_hanzi   sens → 汉字            (auto-évaluation)
--   pinyin_to_meaning  pinyin → 汉字 + sens   (auto-évaluation)
--   hanzi_to_pinyin    汉字 → pinyin saisi    (vérifié automatiquement)
--   meaning_to_pinyin  sens → pinyin saisi    (vérifié automatiquement)

ALTER TABLE review_states RENAME COLUMN direction TO mode;
ALTER TABLE review_states DROP CONSTRAINT review_states_direction_check;
ALTER TABLE review_states ADD CONSTRAINT review_states_mode_check CHECK (
    mode IN ('hanzi_to_meaning', 'meaning_to_hanzi', 'pinyin_to_meaning',
             'hanzi_to_pinyin', 'meaning_to_pinyin')
);

ALTER TABLE review_log RENAME COLUMN direction TO mode;

ALTER TABLE exercises ADD COLUMN modes TEXT[] NOT NULL DEFAULT ARRAY['hanzi_to_meaning'];
UPDATE exercises SET modes = CASE direction
    WHEN 'both' THEN ARRAY['hanzi_to_meaning', 'meaning_to_hanzi']
    ELSE ARRAY[direction]
END;
ALTER TABLE exercises DROP COLUMN direction;
ALTER TABLE exercises ADD CONSTRAINT exercises_modes_check CHECK (
    cardinality(modes) > 0
    AND modes <@ ARRAY['hanzi_to_meaning', 'meaning_to_hanzi', 'pinyin_to_meaning',
                       'hanzi_to_pinyin', 'meaning_to_pinyin']
);
