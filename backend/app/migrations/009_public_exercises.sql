-- Exercices publics : révisables sans compte.
--
-- Un visiteur qui révise un exercice public reçoit un compte « invité » sans mot de passe,
-- tenu par un cookie de session : sa progression est gardée dans son navigateur et rejoint
-- son vrai compte s'il se connecte ensuite.

ALTER TABLE exercises ADD COLUMN public BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_guest_check
    CHECK (NOT is_guest OR (password_hash IS NULL AND NOT is_admin));

CREATE INDEX users_guest_idx ON users (last_login_at) WHERE is_guest;
