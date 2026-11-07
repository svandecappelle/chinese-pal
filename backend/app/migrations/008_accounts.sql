-- Comptes, groupes et droits.
--
-- Les droits sont portés par les groupes ; un administrateur les a tous. Les groupes servent
-- aussi de classes : un exercice (un « cours ») est attribué à des groupes, et chaque utilisateur
-- garde sa propre progression.

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL CHECK (username ~ '^[a-zA-Z0-9._-]{2,40}$'),
    display_name  TEXT NOT NULL DEFAULT '',
    -- NULL : compte sans mot de passe (impossible de s'y connecter). Le premier administrateur
    -- est créé ainsi par cette migration ; l'application lui donne son mot de passe au démarrage.
    password_hash TEXT,
    is_admin      BOOLEAN NOT NULL DEFAULT false,
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    description TEXT,
    permissions TEXT[] NOT NULL DEFAULT '{}' CHECK (
        permissions <@ ARRAY['manage_vocab', 'manage_courses', 'manage_users']
    ),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_groups (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

CREATE INDEX user_groups_group_idx ON user_groups (group_id);

-- Jeton de session : seul son empreinte SHA-256 est stockée.
CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

INSERT INTO users (username, display_name, is_admin) VALUES ('admin', 'Administrateur', true);

INSERT INTO groups (name, description, permissions) VALUES
    ('Professeurs', 'Créent les exercices et enrichissent le vocabulaire',
     ARRAY['manage_vocab', 'manage_courses']),
    ('Élèves', 'Révisent les exercices qui leur sont attribués', '{}');

-- Progression : propre à chaque utilisateur. L'existante revient au premier administrateur.
ALTER TABLE review_states ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
UPDATE review_states SET user_id = (SELECT id FROM users WHERE username = 'admin');
ALTER TABLE review_states ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE review_states DROP CONSTRAINT review_states_pkey;
ALTER TABLE review_states ADD PRIMARY KEY (user_id, word_id, mode);
DROP INDEX review_states_due_at_idx;
CREATE INDEX review_states_user_due_idx ON review_states (user_id, due_at);

ALTER TABLE review_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
UPDATE review_log SET user_id = (SELECT id FROM users WHERE username = 'admin');
ALTER TABLE review_log ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX review_log_user_idx ON review_log (user_id, reviewed_at);

-- Cours : un auteur, des groupes, ou tout le monde.
ALTER TABLE exercises ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE exercises ADD COLUMN everyone BOOLEAN NOT NULL DEFAULT false;
UPDATE exercises SET owner_id = (SELECT id FROM users WHERE username = 'admin'), everyone = true;
-- Deux professeurs peuvent nommer leurs cours pareil.
ALTER TABLE exercises DROP CONSTRAINT exercises_name_key;
ALTER TABLE exercises ADD CONSTRAINT exercises_owner_name_key UNIQUE (owner_id, name);

CREATE TABLE exercise_groups (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, group_id)
);

CREATE INDEX exercise_groups_group_idx ON exercise_groups (group_id);
