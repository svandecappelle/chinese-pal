-- Un mot peut appartenir à plusieurs listes (ex. 你好 dans « HSK 1 » et « Salutations »).

CREATE TABLE deck_words (
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    PRIMARY KEY (deck_id, word_id)
);

CREATE INDEX deck_words_word_id_idx ON deck_words (word_id);

INSERT INTO deck_words (deck_id, word_id)
SELECT deck_id, id FROM words WHERE deck_id IS NOT NULL;

ALTER TABLE words DROP COLUMN deck_id;
