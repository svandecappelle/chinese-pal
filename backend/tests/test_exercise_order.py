"""Ordre des exercices choisi par chacun (glisser-déposer)."""


def names(client):
    return [e["name"] for e in client.call("GET", "/exercises")[1]]


def test_each_user_orders_their_exercises(admin, anon, make_user):
    status, cls = admin.call("POST", "/admin/groups", {"name": "Classe ordre", "permissions": []})
    created = []
    try:
        for name in ("Alpha", "Bêta", "Gamma"):
            ex = admin.call("POST", "/exercises", {"name": f"Ordre {name}", "all_words": True,
                                                   "modes": ["hanzi_to_meaning"], "group_ids": [cls["id"]]})[1]
            created.append(ex)
        a, _ = make_user("ordre", [cls["id"]])
        b, _ = make_user("ordre", [cls["id"]])
        default = names(a)
        assert default == names(b)

        alpha, beta, gamma = (e["id"] for e in created)
        assert anon.call("PUT", "/exercises/order", {"ids": [gamma, alpha]})[0] == 401
        # A place Gamma puis Alpha en tête ; les autres suivent dans l'ordre par défaut.
        assert a.call("PUT", "/exercises/order", {"ids": [gamma, alpha, 999999]})[0] == 204
        mine = names(a)
        assert mine[:2] == ["Ordre Gamma", "Ordre Alpha"]
        assert sorted(mine) == sorted(default)
        assert names(b) == default
        # Un nouvel ordre remplace le précédent.
        everything = [e["id"] for e in a.call("GET", "/exercises")[1]]
        reordered = [beta] + [i for i in everything if i != beta]
        assert a.call("PUT", "/exercises/order", {"ids": reordered})[0] == 204
        assert names(a)[0] == "Ordre Bêta"
        assert a.call("PUT", "/exercises/order", {"ids": ["x"]})[0] == 422
    finally:
        for ex in created:
            admin.call("DELETE", f"/exercises/{ex['id']}")
        admin.call("DELETE", f"/admin/groups/{cls['id']}")
