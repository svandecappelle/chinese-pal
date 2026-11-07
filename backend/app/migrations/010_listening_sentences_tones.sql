-- Nouveaux modes de test : dictée (écoute → caractères, écoute → pinyin, dictée de phrase),
-- phrases d'exemple (mot manquant, mots à remettre dans l'ordre) et tons.

ALTER TABLE review_states DROP CONSTRAINT review_states_mode_check;
ALTER TABLE review_states ADD CONSTRAINT review_states_mode_check CHECK (
    mode IN ('hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning', 'tones',
             'audio_to_pinyin', 'sentence_cloze', 'sentence_order', 'meaning_to_hanzi',
             'audio_to_hanzi', 'hanzi_to_pinyin', 'meaning_to_pinyin', 'sentence_dictation',
             'classifier')
);

ALTER TABLE exercises DROP CONSTRAINT exercises_modes_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_modes_check CHECK (
    cardinality(modes) > 0
    AND modes <@ ARRAY['hanzi_to_meaning', 'pinyin_to_meaning', 'audio_to_meaning', 'tones',
                       'audio_to_pinyin', 'sentence_cloze', 'sentence_order', 'meaning_to_hanzi',
                       'audio_to_hanzi', 'hanzi_to_pinyin', 'meaning_to_pinyin',
                       'sentence_dictation', 'classifier']
);
