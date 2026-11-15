"""Textes gradués : part de mots connus, texte « à ta mesure », mots vus en lecture ; modification et
masquage par les professeurs."""

import pytest

NEW_TEXT = {"level": 2, "title": "测试", "title_fr": "Essai", "text": "我今天很高兴。", "translation": "Je suis content."}


def visible_ids(client):
    return [t["id"] for t in client.call("GET", "/texts")[1]["texts"]]


def test_texts_without_progress(anon):
    status, data = anon.call("GET", "/texts")
    assert (status, data["progress"], data["can_edit"]) == (200, False, False)
    assert len(data["texts"]) >= 12
    assert {t["known"] for t in data["texts"]} == {None}
    assert [t["level"] for t in data["texts"]] == sorted(t["level"] for t in data["texts"])
    assert anon.call("GET", "/texts/99999")[0] == 404
    status, text = anon.call("GET", "/texts/1")
    assert (status, text["title"], text["level"], bool(text["translation"])) == (200, "我的家", 1, True)
    assert len(text["new_words"]) == len(text["new_word_ids"])


def test_text_fits_the_student(anon, make_user):
    lea, _ = make_user("textes")
    text = lea.call("GET", "/texts/1")[1]
    assert text["known"] == 0
    # L'élève a déjà vu tous les mots du texte 1 sauf les deux derniers.
    for word_id in text["new_word_ids"][:-2]:
        lea.call("POST", "/reviews", {"word_id": word_id, "mode": "hanzi_to_meaning", "grade": 3})
    text = lea.call("GET", "/texts/1")[1]
    assert len(text["new_word_ids"]) == 2
    assert text["known"] >= 0.75
    data = lea.call("GET", "/texts")[1]
    assert data["progress"] is True
    assert (data["texts"][0]["id"], data["texts"][0]["fits"]) == (1, True)
    assert [t["id"] for t in data["texts"] if t["fits"]] == [1]

    reading = lea.call("POST", "/ime/lecture", {"text": "我爱我的家。"})[1]
    assert reading["words"]["我"]["seen"] is True
    reading = anon.call("POST", "/ime/lecture", {"text": "我爱我的家。"})[1]
    assert {w["seen"] for w in reading["words"].values()} == {None}


@pytest.fixture
def new_text(admin, sql):
    created = []
    yield created
    for text_id in created:
        sql("DELETE FROM graded_texts WHERE id = %s AND builtin_id IS NULL", (text_id,))


def test_teachers_edit_and_hide_texts(admin, anon, make_user, groups, new_text):
    prof, _ = make_user("prof", [groups["Professeurs"]])
    eleve, _ = make_user("eleve", [groups["Élèves"]])
    assert eleve.call("GET", "/texts")[1]["can_edit"] is False
    assert prof.call("GET", "/texts")[1]["can_edit"] is True
    assert admin.call("GET", "/texts")[1]["can_edit"] is True

    assert eleve.call("POST", "/texts", NEW_TEXT)[0] == 403
    assert anon.call("POST", "/texts", NEW_TEXT)[0] == 401
    assert prof.call("POST", "/texts", NEW_TEXT | {"text": "hello"})[0] == 422
    assert prof.call("POST", "/texts", NEW_TEXT | {"title": "  "})[0] == 422
    assert prof.call("POST", "/texts", NEW_TEXT | {"level": 0})[0] == 422
    status, text = prof.call("POST", "/texts", NEW_TEXT)
    assert (status, text["title"], text["hidden"]) == (201, "测试", False)
    tid = text["id"]
    new_text.append(tid)
    assert tid in visible_ids(eleve)

    edited = prof.call("PUT", f"/texts/{tid}", NEW_TEXT | {"text": "我今天非常高兴。", "level": 3})[1]
    assert (edited["text"], edited["level"]) == ("我今天非常高兴。", 3)
    seen_by_student = eleve.call("GET", f"/texts/{tid}")[1]
    assert seen_by_student["can_edit"] is False
    assert {"非常", "非"} & set(seen_by_student["new_words"])
    assert eleve.call("PUT", f"/texts/{tid}", NEW_TEXT)[0] == 403
    assert prof.call("PUT", "/texts/99999", NEW_TEXT)[0] == 404

    assert eleve.call("PUT", f"/texts/{tid}/hidden", {"hidden": True})[0] == 403
    assert prof.call("PUT", f"/texts/{tid}/hidden", {"hidden": True})[1] == {"id": tid, "hidden": True}
    assert tid not in visible_ids(eleve)
    assert tid not in visible_ids(anon)
    assert eleve.call("GET", f"/texts/{tid}")[0] == 404
    listed = {t["id"]: t for t in prof.call("GET", "/texts")[1]["texts"]}
    assert (listed[tid]["hidden"], listed[tid]["fits"]) == (True, False)
    assert prof.call("GET", f"/texts/{tid}")[1]["hidden"] is True
    assert admin.call("PUT", f"/texts/{tid}/hidden", {"hidden": False})[1]["hidden"] is False
    assert eleve.call("GET", f"/texts/{tid}")[0] == 200

    # Un texte fourni se masque aussi.
    assert admin.call("PUT", "/texts/1/hidden", {"hidden": True})[0] == 200
    try:
        assert 1 not in visible_ids(eleve)
    finally:
        admin.call("PUT", "/texts/1/hidden", {"hidden": False})
