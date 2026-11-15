-- Mots personnels : un élève garde dans Mes mots un mot absent du vocabulaire, avec son propre
-- sens. Le mot n'appartient qu'à lui (owner_id) : il n'apparaît ni dans le vocabulaire commun,
-- ni dans les exercices des autres ; il disparaît avec son compte.
ALTER TABLE words ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Unicité : dans le vocabulaire commun, et pour chaque élève parmi ses mots personnels.
ALTER TABLE words DROP CONSTRAINT words_hanzi_pinyin_key;
CREATE UNIQUE INDEX words_shared_key ON words (hanzi, pinyin) WHERE owner_id IS NULL;
CREATE UNIQUE INDEX words_personal_key ON words (owner_id, hanzi, pinyin) WHERE owner_id IS NOT NULL;
