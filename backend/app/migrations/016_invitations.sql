-- Liens d'invitation : un professeur ou un administrateur crée un lien, la personne qui l'ouvre
-- crée elle-même son compte et rejoint les groupes de l'invitation.
--
-- Le jeton est gardé en clair pour que l'auteur puisse recopier le lien plus tard ; il ne donne
-- que le droit de créer un compte dans ces groupes, expire et peut être révoqué.

CREATE TABLE invitations (
    id          SERIAL PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    group_ids   INTEGER[] NOT NULL DEFAULT '{}',
    -- NULL : nombre d'inscriptions illimité jusqu'à l'expiration.
    max_uses    INTEGER CHECK (max_uses > 0),
    uses        INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invitations_created_by_idx ON invitations (created_by);

-- Compte créé par une invitation : visible dans le suivi des invitations.
ALTER TABLE users ADD COLUMN invitation_id INTEGER REFERENCES invitations(id) ON DELETE SET NULL;
