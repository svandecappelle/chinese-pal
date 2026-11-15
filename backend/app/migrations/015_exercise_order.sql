-- Ordre des exercices choisi par chacun (glisser-déposer sur la page Exercices).
CREATE TABLE exercise_order (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (user_id, exercise_id)
);
