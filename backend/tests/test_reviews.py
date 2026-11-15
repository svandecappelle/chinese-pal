"""Réponses : reprogrammation, et heure réelle des réponses données hors ligne (`answered_at`)."""

from datetime import datetime, timedelta, timezone


def iso(moment: datetime) -> str:
    return moment.isoformat()


def last_answer(sql, user_id, word_id, mode="hanzi_to_meaning"):
    return sql("""SELECT l.reviewed_at, s.last_reviewed_at, s.first_reviewed_at, s.due_at
                  FROM review_log l JOIN review_states s USING (user_id, word_id, mode)
                  WHERE l.user_id = %s AND l.word_id = %s AND l.mode = %s
                  ORDER BY l.id DESC LIMIT 1""", (user_id, word_id, mode))[0]


def close(a: datetime, b: datetime, seconds=5) -> bool:
    return abs((a - b).total_seconds()) <= seconds


def test_answer_now(admin, make_user, sql):
    lea, user = make_user("rev")
    word = admin.call("GET", "/words")[1][0]["id"]
    status, card = lea.call("POST", "/reviews", {"word_id": word, "mode": "hanzi_to_meaning", "grade": 3})
    assert status == 200
    row = last_answer(sql, user["id"], word)
    assert close(row["reviewed_at"], datetime.now(timezone.utc))
    assert row["due_at"] > datetime.now(timezone.utc)


def test_offline_answer_keeps_its_time(admin, make_user, sql):
    lea, user = make_user("rev")
    words = [w["id"] for w in admin.call("GET", "/words")[1][:4]]
    now = datetime.now(timezone.utc)

    # Donnée il y a 3 heures, envoyée maintenant : comptée et reprogrammée il y a 3 heures.
    three_hours_ago = now - timedelta(hours=3)
    review = {"word_id": words[0], "mode": "hanzi_to_meaning", "grade": 3, "answered_at": iso(three_hours_ago)}
    assert lea.call("POST", "/reviews", review)[0] == 200
    row = last_answer(sql, user["id"], words[0])
    assert close(row["reviewed_at"], three_hours_ago)
    assert close(row["first_reviewed_at"], three_hours_ago)
    assert close(row["last_reviewed_at"], three_hours_ago)
    # Ratée (note 1) il y a 3 heures : la carte est déjà à revoir.
    review = {"word_id": words[1], "mode": "hanzi_to_meaning", "grade": 1, "answered_at": iso(three_hours_ago)}
    lea.call("POST", "/reviews", review)
    assert last_answer(sql, user["id"], words[1])["due_at"] <= datetime.now(timezone.utc)

    # Jamais dans le futur.
    review = {"word_id": words[2], "mode": "hanzi_to_meaning", "grade": 3, "answered_at": iso(now + timedelta(days=2))}
    lea.call("POST", "/reviews", review)
    assert close(last_answer(sql, user["id"], words[2])["reviewed_at"], datetime.now(timezone.utc))

    # Pas plus de 30 jours en arrière.
    review = {"word_id": words[3], "mode": "hanzi_to_meaning", "grade": 3, "answered_at": iso(now - timedelta(days=90))}
    lea.call("POST", "/reviews", review)
    assert close(last_answer(sql, user["id"], words[3])["reviewed_at"], now - timedelta(days=30), seconds=60)

    # Jamais avant la réponse précédente sur la même carte.
    review = {"word_id": words[0], "mode": "hanzi_to_meaning", "grade": 4, "answered_at": iso(now - timedelta(hours=5))}
    lea.call("POST", "/reviews", review)
    assert close(last_answer(sql, user["id"], words[0])["reviewed_at"], three_hours_ago)

    # Heure sans fuseau : UTC.
    naive = (now - timedelta(hours=1)).replace(tzinfo=None)
    review = {"word_id": words[1], "mode": "hanzi_to_meaning", "grade": 3, "answered_at": naive.isoformat()}
    lea.call("POST", "/reviews", review)
    assert close(last_answer(sql, user["id"], words[1])["reviewed_at"], now - timedelta(hours=1))

    assert lea.call("POST", "/reviews", review | {"answered_at": "pas une date"})[0] == 422
