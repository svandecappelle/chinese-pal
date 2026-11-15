"""Comptes, groupes et droits : ce que voit et peut faire chacun."""


def test_health(anon):
    assert anon.call("GET", "/health") == (200, {"status": "ok"})


def test_visitor(anon):
    assert anon.call("GET", "/words")[0] == 200
    assert anon.call("POST", "/words", {"hanzi": "测", "pinyin": "cè", "translation": "t"})[0] == 401
    assert anon.call("GET", "/account")[1]["user"] is None
    assert anon.call("POST", "/account/login", {"username": "admin", "password": "nope"})[0] == 401


def test_admin(admin, groups):
    body = admin.call("GET", "/account")[1]
    assert body["user"]["permissions"] == ["manage_courses", "manage_users", "manage_vocab"]
    exercises = {e["name"]: e for e in admin.call("GET", "/exercises")[1]}
    everything = exercises["Tout le vocabulaire"]
    assert (everything["assigned"], everything["can_edit"]) == (True, True)
    assert {"Professeurs", "Élèves"} <= set(groups)
    me = body["user"]["id"]
    assert admin.call("DELETE", f"/admin/users/{me}")[0] == 400
    assert admin.call("PUT", f"/admin/users/{me}", {"username": "admin", "is_admin": False})[0] == 400


def test_rights_and_courses(admin, anon, make_user, groups):
    status, cls = admin.call("POST", "/admin/groups", {"name": "Classe de test", "permissions": []})
    assert status == 201
    try:
        prof, _ = make_user("prof", [groups["Professeurs"]])
        eleve, eleve_user = make_user("eleve", [cls["id"]])
        other, _ = make_user("autre")
        assert admin.call("POST", "/admin/users", {"username": eleve_user["username"].upper()})[0] == 409

        assert eleve.call("POST", "/words", {"hanzi": "测", "pinyin": "cè", "translation": "t"})[0] == 403
        assert eleve.call("POST", "/exercises", {"name": "x"})[0] == 403
        assert eleve.call("GET", "/admin/users")[0] == 403
        assert prof.call("GET", "/admin/users")[0] == 403
        assert prof.call("GET", "/admin/groups")[0] == 200

        word_ids = [w["id"] for w in anon.call("GET", "/words")[1][:5]]
        status, course = prof.call("POST", "/exercises", {
            "name": "Cours test", "word_ids": word_ids, "modes": ["hanzi_to_meaning"], "group_ids": [cls["id"]]})
        assert status == 201
        cid = course["id"]
        assert [x["name"] for x in eleve.call("GET", "/exercises")[1]] == ["Tout le vocabulaire", "Cours test"]
        assert other.call("GET", f"/exercises/{cid}")[0] == 404
        assert eleve.call("PUT", f"/exercises/{cid}", {"name": "pirate"})[0] == 403
        assert eleve.call("DELETE", f"/exercises/{cid}")[0] == 403
        assert eleve.call("GET", f"/exercises/{cid}/progress")[0] == 403

        status, session = eleve.call("GET", f"/exercises/{cid}/session")
        assert (status, len(session["cards"])) == (200, 5)
        card = session["cards"][0]
        assert eleve.call("POST", "/reviews", {"word_id": card["word_id"], "mode": card["mode"], "grade": 3})[0] == 200
        progress = prof.call("GET", f"/exercises/{cid}/progress")[1]
        by_name = {s["username"]: s for s in progress["students"]}
        assert list(by_name) == [eleve_user["username"]]
        assert by_name[eleve_user["username"]]["stats"]["unseen"] == 4
        assert [x["stats"]["unseen"] for x in prof.call("GET", "/exercises")[1] if x["id"] == cid] == [5]
        admin.call("DELETE", f"/exercises/{cid}")
    finally:
        admin.call("DELETE", f"/admin/groups/{cls['id']}")


def test_password_and_deactivation(admin, make_user):
    eleve, user = make_user()
    assert eleve.call("PUT", "/account/password", {"current": "x", "new": "abcdefgh"})[0] == 400
    assert eleve.call("PUT", "/account/password", {"current": user["password"], "new": "nouveau-mdp"})[0] == 204
    assert eleve.call("GET", "/account")[1]["user"]["username"] == user["username"]
    assert admin.call("POST", f"/admin/users/{user['id']}/password")[0] == 200
    assert eleve.call("GET", "/account")[1]["user"] is None

    other, other_user = make_user()
    body = {"username": other_user["username"], "active": False}
    assert admin.call("PUT", f"/admin/users/{other_user['id']}", body)[0] == 200
    assert other.call("GET", "/account")[1]["user"] is None
    login = {"username": other_user["username"], "password": other_user["password"]}
    assert other.call("POST", "/account/login", login)[0] == 401


def test_logout(make_user):
    eleve, _ = make_user()
    assert eleve.call("POST", "/account/logout")[0] == 204
    assert eleve.call("GET", "/account")[1]["user"] is None
