"""Mes mots : liste personnelle, notes, mots hors vocabulaire, et leur ajout au vocabulaire commun."""


def first_words(admin, n):
    return [w["id"] for w in admin.call("GET", "/words")[1][:n]]


def test_my_words_and_notes(admin, anon, make_user):
    lea, student = make_user("mots", display_name="Léa")
    assert anon.call("GET", "/my-words")[0] == 401
    status, data = lea.call("GET", "/my-words")
    assert (status, data["exercise"], data["words"]) == (200, None, [])
    w1, w2 = first_words(admin, 2)

    assert lea.call("PUT", "/my-words/999999")[0] == 404
    status, added = lea.call("PUT", f"/my-words/{w1}")
    assert (status, added["in_list"]) == (200, True)
    assert lea.call("PUT", f"/my-words/{w1}")[0] == 200
    lea.call("PUT", f"/my-words/{w2}")
    assert lea.call("GET", f"/my-words/{w1}")[1] == {"word_id": w1, "in_list": True, "note": None, "personal": False}

    note = "une femme et son enfant"
    assert lea.call("PUT", f"/my-words/{w1}/note", {"note": f"  {note}  "})[1]["note"] == note
    assert lea.call("PUT", f"/my-words/{w1}/note", {"note": "x" * 501})[0] == 422
    data = lea.call("GET", "/my-words")[1]
    assert [w["word_id"] for w in data["words"]] == [w2, w1]
    assert data["words"][1]["note"] == note
    ex = data["exercise"]
    assert (ex["stats"]["unseen"] > 0, ex["name"]) == (True, "Mes mots")

    exercises = lea.call("GET", "/exercises")[1]
    mine = next(e for e in exercises if e["id"] == ex["id"])
    assert (exercises[0]["id"], mine["personal"], mine["can_edit"]) == (ex["id"], True, False)
    assert not any(e["id"] == ex["id"] for e in admin.call("GET", "/exercises")[1])
    assert admin.call("DELETE", f"/exercises/{ex['id']}")[0] in (403, 404)

    status, session = lea.call("GET", f"/exercises/{ex['id']}/session")
    assert status == 200
    noted = [c for c in session["cards"] if c["word_id"] == w1]
    assert noted and all(c["note"] == note for c in noted)
    study = lea.call("GET", f"/exercises/{ex['id']}/words")[1]["words"]
    assert next(w["note"] for w in study if w["word_id"] == w1) == note

    feed = lea.call("GET", "/feed")[1]
    assert feed["my_words"] == 2
    assert any(s["exercise_id"] == ex["id"] for s in feed["upcoming"])
    assert not any(e["type"] == "exercise" and e["exercise_id"] == ex["id"] for e in feed["events"])

    assert lea.call("DELETE", f"/my-words/{w1}")[0] == 204
    data = lea.call("GET", "/my-words")[1]
    assert [w["word_id"] for w in data["words"]] == [w2]
    # La note reste : « autres mots annotés ».
    assert [w["word_id"] for w in data["notes"]] == [w1]
    assert lea.call("PUT", f"/my-words/{w1}/note", {"note": " "})[1]["note"] is None
    assert lea.call("GET", "/my-words")[1]["notes"] == []

    # L'exercice personnel disparaît avec le compte.
    assert admin.call("DELETE", f"/admin/users/{student['id']}")[0] == 204
    assert lea.call("GET", f"/exercises/{ex['id']}")[0] in (401, 404)


def test_personal_word(admin, anon, make_user):
    word = "麒麟"
    assert anon.call("POST", "/ime/lecture", {"text": word})[1]["words"][word]["word_id"] is None
    a, a_user = make_user("perso")
    b, _ = make_user("perso")
    new = {"hanzi": word, "pinyin": "qílín", "translation": "licorne chinoise"}

    assert anon.call("POST", "/my-words", new)[0] == 401
    assert a.call("POST", "/my-words", {"hanzi": "abc", "pinyin": "a", "translation": "x"})[0] == 422
    assert a.call("POST", "/my-words", new | {"translation": "  "})[0] == 422

    status, w = a.call("POST", "/my-words", new)
    assert (status, w["personal"], w["in_list"]) == (201, True, True)
    wid = w["word_id"]
    again = a.call("POST", "/my-words", new | {"translation": "qilin"})[1]
    assert (again["word_id"], again["translation"]) == (wid, "qilin")

    mine = a.call("GET", "/my-words")[1]
    assert [(x["word_id"], x["personal"]) for x in mine["words"]] == [(wid, True)]
    assert a.call("GET", f"/words/{wid}")[1]["personal"] is True
    assert b.call("GET", f"/words/{wid}")[0] == 404
    assert anon.call("GET", f"/words/{wid}")[0] == 404
    assert b.call("PUT", f"/my-words/{wid}")[0] == 404
    assert wid not in {x["id"] for x in admin.call("GET", "/words")[1]}

    seen = a.call("POST", "/ime/lecture", {"text": word})[1]["words"][word]
    assert (seen["word_id"], seen["personal"], seen["translation"]) == (wid, True, "qilin")
    assert b.call("POST", "/ime/lecture", {"text": word})[1]["words"][word]["word_id"] is None

    assert a.call("PATCH", f"/my-words/{wid}", {"translation": "licorne"})[1]["translation"] == "licorne"
    assert b.call("PATCH", f"/my-words/{wid}", {"translation": "x"})[0] == 404
    assert a.call("PUT", f"/my-words/{wid}/note", {"note": "麒 + 麟"})[0] == 200

    session = a.call("GET", f"/exercises/{mine['exercise']['id']}/session")[1]
    assert any(c["word_id"] == wid for c in session["cards"])
    assert a.call("POST", "/reviews", {"word_id": wid, "mode": "hanzi_to_meaning", "grade": 3})[0] == 200
    # Un éditeur ne touche pas au mot personnel.
    assert admin.call("DELETE", f"/words/{wid}")[0] == 404

    # Le retirer de Mes mots le supprime.
    assert a.call("DELETE", f"/my-words/{wid}")[0] == 204
    assert a.call("GET", f"/words/{wid}")[0] == 404
    assert a.call("GET", "/my-words")[1]["words"] == []

    # Il disparaît avec le compte.
    w = a.call("POST", "/my-words", new)[1]
    admin.call("DELETE", f"/admin/users/{a_user['id']}")
    assert admin.call("GET", f"/words/{w['word_id']}")[0] == 404


def test_student_words_join_the_vocabulary(admin, make_user, groups):
    w1, w2 = "貔貅", "凤凰"
    a, _ = make_user("adopt", [groups["Élèves"]])
    b, _ = make_user("adopt", [groups["Élèves"]])
    prof, _ = make_user("prof", [groups["Professeurs"]])
    shared_ids = []
    try:
        assert a.call("GET", "/student-words")[0] == 403
        assert not [w for w in prof.call("GET", "/student-words")[1] if w["hanzi"] in (w1, w2)]

        wa = a.call("POST", "/my-words", {"hanzi": w1, "pinyin": "píxiū", "translation": "pixiu"})[1]["word_id"]
        b.call("POST", "/my-words", {"hanzi": w1, "pinyin": "píxiū", "translation": "animal mythique"})
        b.call("POST", "/my-words", {"hanzi": w2, "pinyin": "fènghuáng", "translation": "phénix"})
        a.call("POST", "/reviews", {"word_id": wa, "mode": "hanzi_to_meaning", "grade": 3})
        a.call("PUT", f"/my-words/{wa}/note", {"note": "gardien"})

        listed = prof.call("GET", "/student-words")[1]
        rows = {w["hanzi"]: w for w in listed}
        assert (rows[w1]["students"], listed[0]["hanzi"]) == (2, w1)
        assert sorted(rows[w1]["translations"]) == ["animal mythique", "pixiu"]
        assert rows[w1]["shared_id"] is None

        adopt = {"hanzi": w1, "pinyin": "píxiū", "translation": "pixiu (animal mythique)"}
        assert a.call("POST", "/student-words/adopt", adopt)[0] == 403
        status, word = prof.call("POST", "/student-words/adopt", adopt)
        assert (status, word["merged"], word["translation"]) == (200, 2, "pixiu (animal mythique)")
        shared_ids.append(word["id"])
        assert word["id"] in {w["id"] for w in prof.call("GET", "/words")[1]}
        assert w1 not in {w["hanzi"] for w in prof.call("GET", "/student-words")[1]}

        # A garde sa place dans Mes mots, sa note et sa progression, sur le mot commun.
        mine = a.call("GET", "/my-words")[1]["words"]
        assert [(w["word_id"], w["personal"], w["note"]) for w in mine] == [(word["id"], False, "gardien")]
        assert a.call("POST", "/ime/lecture", {"text": w1})[1]["words"][w1]["seen"] is True
        assert a.call("GET", f"/words/{wa}")[0] == 404
        assert sorted((w["hanzi"], w["personal"]) for w in b.call("GET", "/my-words")[1]["words"]) == \
            [(w2, True), (w1, False)]

        # Un mot ajouté autrement au vocabulaire est fondu de la même façon.
        status, word2 = prof.call("POST", "/words", {"hanzi": w2, "pinyin": "fènghuáng", "translation": "phénix"})
        assert status == 201
        shared_ids.append(word2["id"])
        assert sorted((w["hanzi"], w["personal"]) for w in b.call("GET", "/my-words")[1]["words"]) == \
            [(w2, False), (w1, False)]
        assert not [w for w in prof.call("GET", "/student-words")[1] if w["hanzi"] in (w1, w2)]
    finally:
        for word_id in shared_ids:
            admin.call("DELETE", f"/words/{word_id}")
