"""Données des modes de test sur les tons et sur les phrases d'exemple.

- `syllables` : aligne le pinyin d'un mot sur ses caractères (mode « tons ») ;
- `tiles` : découpe une phrase en mots à remettre dans l'ordre ;
- `cloze` : phrase à trous et mots proposés.

Les lectures et les mots connus viennent du dictionnaire de saisie (CC-CEDICT, voir ime.py).
"""

import random
import re
import unicodedata

from .ime import dictionary

HANZI = re.compile(r"[㐀-鿿]")
# Accents de ton (forme décomposée) → ton.
TONE_MARKS = {"̄": 1, "́": 2, "̌": 3, "̀": 4}
SEPARATORS = " '’-·"
MAX_WORD = 4


def _known() -> tuple[dict[str, set[str]], set[str]]:
    try:
        dictionary.load()
    except FileNotFoundError:
        return {}, set()
    return dictionary.char_syllables, dictionary.words


def _letters(pinyin: str) -> list[tuple[str, int]] | None:
    """« nǚ'ér » → [('n',0), ('v',3), ('|',0), ('e',2), ('r',0)] ; '|' marque une séparation."""
    out: list[tuple[str, int]] = []
    for char in unicodedata.normalize("NFD", pinyin.lower()):
        if char in TONE_MARKS:
            if not out:
                return None
            out[-1] = (out[-1][0], TONE_MARKS[char])
        elif char == "̈":  # tréma : u → ü (noté v)
            if not out or out[-1][0] != "u":
                return None
            out[-1] = ("v", out[-1][1])
        elif "a" <= char <= "z":
            out.append((char, 0))
        elif char in SEPARATORS:
            out.append(("|", 0))
        else:
            return None
    return out


def syllables(hanzi: str, pinyin: str) -> list[dict] | None:
    """Une syllabe par caractère : [{hanzi, base (sans ton, ü noté v), tone (0 = neutre)}],
    ou None si le pinyin ne s'aligne pas sur les caractères."""
    readings, _ = _known()
    letters = _letters(pinyin)
    if not readings or letters is None or not all(HANZI.match(c) for c in hanzi):
        return None
    text = "".join(c for c, _ in letters)

    def solve(i: int, pos: int) -> list[tuple[int, int]] | None:
        while pos < len(text) and text[pos] == "|":
            pos += 1
        if i == len(hanzi):
            return [] if pos == len(text) else None
        options = set(readings.get(hanzi[i], ()))
        if hanzi[i] == "儿":
            options.add("r")  # érhua : 一点儿 yīdiǎnr
        for base in sorted(options, key=len, reverse=True):
            if text.startswith(base, pos):
                rest = solve(i + 1, pos + len(base))
                if rest is not None:
                    return [(pos, pos + len(base)), *rest]
        return None

    spans = solve(0, 0)
    if spans is None:
        return None
    result = []
    for char, (start, end) in zip(hanzi, spans):
        tones = [t for _, t in letters[start:end] if t]
        result.append({"hanzi": char, "base": text[start:end], "tone": tones[0] if tones else 0})
    return result


def _segment_part(text: str, words: set[str]) -> list[str]:
    tokens: list[str] = []
    i = 0
    while i < len(text):
        char = text[i]
        if HANZI.match(char):
            piece = char
            for size in range(MAX_WORD, 1, -1):
                candidate = text[i:i + size]
                if len(candidate) == size and all(HANZI.match(c) for c in candidate) and candidate in words:
                    piece = candidate
                    break
        elif char.isascii() and char.isalnum():
            piece = re.match(r"[0-9A-Za-z]+", text[i:]).group(0)
        else:
            i += 1  # ponctuation et espaces
            continue
        tokens.append(piece)
        i += len(piece)
    return tokens


def segment(sentence: str, keep: str = "") -> list[str]:
    """Découpe une phrase en mots (plus long mot connu d'abord), sans la ponctuation.
    `keep` (le mot révisé) reste toujours d'un seul tenant."""
    _, words = _known()
    if not keep or keep not in sentence:
        return _segment_part(sentence, words)
    tokens: list[str] = []
    parts = sentence.split(keep)
    for n, part in enumerate(parts):
        tokens += _segment_part(part, words)
        if n < len(parts) - 1:
            tokens.append(keep)
    return tokens


def tiles(sentence: str, word: str) -> list[str] | None:
    """Mots de la phrase dans l'ordre (le client les mélange), s'il y en a au moins 3."""
    found = segment(sentence, word)
    return found if len(found) >= 3 else None


def cloze(sentence: str, word: str, pool: dict[str, list[str]], word_classifiers: list[str]) -> dict | None:
    """Phrase avec le mot remplacé par un trou, et 4 mots proposés (le bon compris).

    `pool` : mots candidats → leurs classificateurs. Un mot qui partage un classificateur avec le
    mot attendu irait souvent aussi dans la phrase (一只狗, 一只猫) : il n'est pas proposé."""
    at = sentence.find(word)
    if at < 0:
        return None
    candidates = [w for w, found in pool.items()
                  if w != word and w not in sentence and not set(found) & set(word_classifiers)]
    same_length = [w for w in candidates if len(w) == len(word)]
    others = [w for w in candidates if len(w) != len(word)]
    random.shuffle(same_length)
    random.shuffle(others)
    choices = [word, *(same_length + others)[:3]]
    random.shuffle(choices)
    return {"before": sentence[:at], "after": sentence[at + len(word):], "choices": choices}


READING_MAX_WORD = 6


def reading_tokens(text: str) -> list[tuple[str, bool]]:
    """Découpe un texte pour la lecture assistée : [(morceau, est_un_mot_chinois)], sans rien
    perdre (ponctuation, espaces, lettres et retours à la ligne restent en morceaux simples)."""
    _, words = _known()
    tokens: list[tuple[str, bool]] = []
    i = 0
    while i < len(text):
        if HANZI.match(text[i]):
            piece = text[i]
            for size in range(READING_MAX_WORD, 1, -1):
                candidate = text[i:i + size]
                if len(candidate) == size and candidate in words:
                    piece = candidate
                    break
            tokens.append((piece, True))
            i += len(piece)
        else:
            j = i
            while j < len(text) and not HANZI.match(text[j]):
                j += 1
            tokens.append((text[i:j], False))
            i = j
    return tokens
