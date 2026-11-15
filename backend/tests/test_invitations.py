"""Liens d'invitation : la personne invitée crée elle-même son compte."""
import secrets

from conftest import Client


def signup(token, username=None, password="motdepasse-invite", **extra):
    client = Client()
    username = username or f"inscrit-{secrets.token_hex(3)}"
    status, body = client.call("POST", f"/invitations/{token}/signup",
                               {"username": username, "password": password, **extra})
    return client, status, body


def test_teacher_invites_into_a_class(admin, anon, make_user, groups, sql):
    status, cls = admin.call("POST", "/admin/groups", {"name": "Classe invitée", "permissions": []})
    assert status == 201
    created = []
    try:
        teacher, _ = make_user("prof", [groups["Professeurs"]])
        student, _ = make_user("eleve")
        # Seuls les professeurs et les gestionnaires de comptes invitent.
        assert anon.call("POST", "/invitations", {})[0] == 401
        assert student.call("POST", "/invitations", {})[0] == 403
        assert student.call("GET", "/invitations")[0] == 403
        # Un professeur n'invite pas dans un groupe qui donne des droits.
        assert teacher.call("POST", "/invitations", {"group_ids": [groups["Professeurs"]]})[0] == 403
        assert teacher.call("POST", "/invitations", {"group_ids": [999999]})[0] == 400

        status, inv = teacher.call("POST", "/invitations",
                                   {"group_ids": [cls["id"]], "note": "3e B", "max_uses": 2, "days": 7})
        assert status == 201
        assert inv["valid"] and inv["uses"] == 0 and inv["group_names"] == ["Classe invitée"]
        token = inv["token"]

        status, info = anon.call("GET", f"/invitations/{token}/info")
        assert status == 200
        assert info["groups"] == ["Classe invitée"] and info["note"] == "3e B"
        assert "token" not in info

        # Inscription : compte créé, connecté, dans la classe.
        client, status, body = signup(token, display_name="Léa")
        assert status == 201
        created.append(body["user"]["id"])
        assert body["user"]["display_name"] == "Léa" and body["user"]["permissions"] == []
        me = client.call("GET", "/account")[1]["user"]
        assert me["id"] == body["user"]["id"]
        members = admin.call("GET", "/admin/groups")[1]
        assert body["user"]["id"] in next(g for g in members if g["id"] == cls["id"])["member_ids"]

        # Identifiant pris, mot de passe trop court, identifiant invalide.
        assert signup(token, username=body["user"]["username"])[1] == 409
        assert signup(token, password="court")[1] == 422
        assert signup(token, username="é !")[1] == 422

        # 2e inscription, puis le lien est épuisé.
        _, status, body2 = signup(token)
        assert status == 201
        created.append(body2["user"]["id"])
        assert signup(token)[1] == 404
        assert anon.call("GET", f"/invitations/{token}/info")[0] == 404

        mine = teacher.call("GET", "/invitations")[1]
        listed = next(i for i in mine if i["id"] == inv["id"])
        assert listed["uses"] == 2 and not listed["valid"]
        assert {a["id"] for a in listed["accounts"]} == set(created)
        # Le gestionnaire de comptes voit toutes les invitations.
        assert inv["id"] in [i["id"] for i in admin.call("GET", "/invitations")[1]]
    finally:
        for user_id in created:
            admin.call("DELETE", f"/admin/users/{user_id}")
        admin.call("DELETE", f"/admin/groups/{cls['id']}")


def test_expired_revoked_and_unknown_links(admin, make_user, groups, sql):
    teacher, _ = make_user("prof", [groups["Professeurs"]])
    other, _ = make_user("prof", [groups["Professeurs"]])
    inv = teacher.call("POST", "/invitations", {"group_ids": [groups["Élèves"]]})[1]
    assert inv["max_uses"] is None

    # Un autre professeur ne voit ni ne révoque l'invitation.
    assert inv["id"] not in [i["id"] for i in other.call("GET", "/invitations")[1]]
    assert other.call("DELETE", f"/invitations/{inv['id']}")[0] == 404

    sql("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = %s", (inv["id"],))
    assert signup(inv["token"])[1] == 404
    sql("UPDATE invitations SET expires_at = now() + interval '1 day' WHERE id = %s", (inv["id"],))

    assert teacher.call("DELETE", f"/invitations/{inv['id']}")[0] == 204
    assert signup(inv["token"])[1] == 404
    assert signup("jeton-inconnu")[1] == 404


def test_admin_can_invite_teachers(admin, groups):
    status, inv = admin.call("POST", "/invitations", {"group_ids": [groups["Professeurs"]], "max_uses": 1})
    assert status == 201
    _, status, body = signup(inv["token"])
    try:
        assert status == 201
        assert "manage_courses" in body["user"]["permissions"]
        assert not body["user"]["is_admin"]
    finally:
        admin.call("DELETE", f"/admin/users/{body['user']['id']}")
        admin.call("DELETE", f"/invitations/{inv['id']}")


def test_guest_progress_follows_into_new_account(admin, anon, groups, sql):
    words = [w["id"] for w in anon.call("GET", "/words")[1][:2]]
    pub = admin.call("POST", "/exercises", {"name": "Public invitation", "word_ids": words,
                                            "modes": ["hanzi_to_meaning"], "public": True})[1]
    inv = admin.call("POST", "/invitations", {"group_ids": [groups["Élèves"]]})[1]
    try:
        guest = Client()
        review = {"word_id": words[0], "mode": "hanzi_to_meaning", "grade": 3}
        assert guest.call("POST", "/reviews", review)[0] == 200
        assert guest.call("GET", "/account")[1]["guest"] is True
        status, body = guest.call("POST", f"/invitations/{inv['token']}/signup",
                                  {"username": f"inscrit-{secrets.token_hex(3)}", "password": "motdepasse-invite"})
        assert status == 201
        user_id = body["user"]["id"]
        kept = sql("SELECT count(*) AS n FROM review_states WHERE user_id = %s", (user_id,))[0]["n"]
        assert kept == 1
        assert guest.call("GET", "/account")[1]["user"]["id"] == user_id
        admin.call("DELETE", f"/admin/users/{user_id}")
    finally:
        admin.call("DELETE", f"/invitations/{inv['id']}")
        admin.call("DELETE", f"/exercises/{pub['id']}")
