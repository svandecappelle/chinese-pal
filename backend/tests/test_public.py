"""Exercices publics et invités : un visiteur révise sans compte, puis sa progression rejoint son compte."""

from conftest import Client


def test_public_exercise_and_guest(admin, anon, make_user):
    words = [w["id"] for w in anon.call("GET", "/words")[1][:4]]
    other_word = anon.call("GET", "/words")[1][10]["id"]
    status, pub = admin.call("POST", "/exercises", {"name": "Public test", "word_ids": words,
                                                    "modes": ["hanzi_to_meaning"], "public": True})
    assert (status, pub["public"]) == (201, True)
    priv = admin.call("POST", "/exercises", {"name": "Privé test", "word_ids": words, "everyone": True})[1]
    try:
        _, eleve = make_user("public")
        visitor = Client()
        assert [x["name"] for x in visitor.call("GET", "/exercises")[1]] == ["Public test"]
        assert visitor.call("GET", f"/exercises/{priv['id']}/session")[0] == 404
        status, session = visitor.call("GET", f"/exercises/{pub['id']}/session")
        assert (status, len(session["cards"])) == (200, 4)
        assert visitor.call("GET", "/account")[1]["guest"] is False
        # Une réponse hors de l'exercice public (autre mot, autre mode) ne crée pas d'invité.
        review = {"word_id": other_word, "mode": "hanzi_to_meaning", "grade": 3}
        assert visitor.call("POST", "/reviews", review)[0] == 401
        review = {"word_id": words[0], "mode": "meaning_to_hanzi", "grade": 3}
        assert visitor.call("POST", "/reviews", review)[0] == 401
        assert visitor.call("POST", "/reviews", {"word_id": words[0], "mode": "hanzi_to_meaning", "grade": 3})[0] == 200
        me = visitor.call("GET", "/account")[1]
        assert (me["guest"], me["user"]) == (True, None)
        assert visitor.call("POST", "/reviews", {"word_id": words[1], "mode": "hanzi_to_meaning", "grade": 3})[0] == 200
        listed = visitor.call("GET", "/exercises")[1]
        assert [x["name"] for x in listed] == ["Public test"]
        assert listed[0]["stats"]["unseen"] == 2
        assert visitor.call("GET", "/admin/users")[0] == 401
        assert visitor.call("PUT", "/account/password", {"current": "x", "new": "abcdefgh"})[0] == 401
        assert not any(u["username"].startswith("invite-") for u in admin.call("GET", "/admin/users")[1])
        assert admin.call("GET", f"/exercises/{pub['id']}/progress")[1]["guests"] == 1

        # Connexion de l'invité : sa progression rejoint le compte.
        visitor.login(eleve["username"], eleve["password"])
        listed = visitor.call("GET", "/exercises")[1]
        assert [x["stats"]["unseen"] for x in listed if x["name"] == "Public test"] == [2]
        assert sorted(x["name"] for x in listed if x["name"].endswith("test")) == ["Privé test", "Public test"]
        progress = admin.call("GET", f"/exercises/{pub['id']}/progress")[1]
        assert progress["guests"] == 0
        assert [s["username"] for s in progress["students"]].count(eleve["username"]) == 1

        assert visitor.call("POST", "/account/logout")[0] == 204
        me = visitor.call("GET", "/account")[1]
        assert (me["user"], me["guest"]) == (None, False)
    finally:
        admin.call("DELETE", f"/exercises/{pub['id']}")
        admin.call("DELETE", f"/exercises/{priv['id']}")
