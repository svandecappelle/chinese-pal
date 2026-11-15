"""Fil de révision : pas planifiés, session d'un pas, pas terminé, fil, rythme."""

from conftest import Client


def test_feed(admin, make_user, sql):
    lea, student = make_user("fil", display_name="Léa")
    # La liste « Démo » (migration 001) : 3 mots.
    status, ex = admin.call("POST", "/exercises", {"name": "Essai fil", "deck_ids": [1], "new_per_day": 12,
                                                   "modes": ["hanzi_to_meaning"], "everyone": True})
    assert status == 201
    try:
        assert Client().call("GET", "/feed")[0] == 401

        status, feed = lea.call("GET", "/feed")
        assert status == 200
        assert (feed["pace"], feed["done"]) == (3, [])
        mine = [s for s in feed["upcoming"] if s["exercise_id"] == ex["id"]]
        assert [s["kind"] for s in mine] == ["new"]
        assert mine[0]["cards"] == 3
        # Une carte partagée avec « Tout le vocabulaire » n'est comptée qu'une fois.
        others = [s for s in feed["upcoming"] if s["exercise_id"] != ex["id"]]
        assert not set(mine[0]["words"]) & {w for s in others for w in s["words"]}
        assert all(s["cards"] <= 8 for s in feed["upcoming"])

        status, session = lea.call("GET", f"/exercises/{ex['id']}/session?only=new&limit=3")
        assert (status, len(session["cards"])) == (200, 3)
        assert list(dict.fromkeys(c["hanzi"] for c in session["cards"]))[:6] == mine[0]["words"]
        assert lea.call("GET", f"/exercises/{ex['id']}/session?only=due&limit=8")[1]["cards"] == []
        assert lea.call("GET", f"/exercises/{ex['id']}/session?limit=0")[0] == 422

        for card, grade in zip(session["cards"], [1, 3, 4]):
            lea.call("POST", "/reviews", {"word_id": card["word_id"], "mode": card["mode"], "grade": grade})
        step = {"exercise_id": ex["id"], "kind": "new", "answers": 3, "good": 2}
        assert lea.call("POST", "/feed/steps", step)[0] == 201
        assert lea.call("POST", "/feed/steps", {"kind": "autre"})[0] == 422

        feed = lea.call("GET", "/feed")[1]
        done = feed["done"]
        assert len(done) == 1
        assert (done[0]["answers"], done[0]["good"], done[0]["exercise_name"]) == (3, 2, "Essai fil")
        # Une carte ratée ne revient que le lendemain.
        assert "missed" not in [s["kind"] for s in feed["upcoming"] if s["exercise_id"] == ex["id"]]
        assert lea.call("GET", f"/exercises/{ex['id']}/session?only=missed&limit=8")[1]["cards"] == []
        sql("UPDATE review_log SET reviewed_at = reviewed_at - interval '1 day' WHERE user_id = %s", (student["id"],))
        try:
            later = lea.call("GET", "/feed")[1]
            missed = next((s for s in later["upcoming"] if s["kind"] == "missed"), None)
            assert missed and missed["cards"] == 1
            assert len(lea.call("GET", f"/exercises/{ex['id']}/session?only=missed&limit=8")[1]["cards"]) == 1
        finally:
            sql("UPDATE review_log SET reviewed_at = reviewed_at + interval '1 day' WHERE user_id = %s", (student["id"],))

        sitting = next(e for e in feed["events"] if e["type"] == "sitting")
        assert (sitting["answers"], sitting["good"], sitting["steps"], len(sitting["grades"])) == (3, 2, 1, 3)
        assert next(e for e in feed["events"] if e["type"] == "discovered")["count"] == 3
        assert next(d for d in feed["week"] if d["day"] == feed["today"])["steps"] == 1
        assert len(feed["week"]) == 7
        assert feed["progress"]["words_seen"] == 3
        assert feed["tomorrow"]["cards"] == 1

        assert lea.call("PUT", "/feed/pace", {"steps": 2})[0] == 200
        assert lea.call("PUT", "/feed/pace", {"steps": 0})[0] == 422
        assert lea.call("GET", "/feed")[1]["pace"] == 2
        lea.call("POST", "/feed/steps", {"exercise_id": ex["id"], "kind": "missed", "answers": 2, "good": 2})
        feed = lea.call("GET", "/feed")[1]
        # Objectif atteint : un pas de plus reste proposé.
        assert (len(feed["done"]), len(feed["upcoming"]) >= 1) == (2, True)
        assert "goal" in [e["type"] for e in feed["events"]]
    finally:
        admin.call("DELETE", f"/exercises/{ex['id']}")
