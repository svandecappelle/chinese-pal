"""Saisie des caractères par le pinyin : pinyin tapé (sans tons) → caractères candidats.

Les lectures viennent de CC-CEDICT (CC BY-SA 4.0), téléchargé à la construction de l'image ;
les candidats sont classés par fréquence d'usage (dictionnaire de jieba et lexique, livrés avec le
modèle de synthèse vocale), les mots du vocabulaire de l'app passant en premier.
"""

import bisect
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)

CEDICT_LINE = re.compile(r"^\S+ (\S+) \[([^\]]+)\] /(.*)/$")
HANZI = re.compile(r"^[㐀-鿿]+$")
SYLLABLE = re.compile(r"^[a-z]+[1-5]$")


@dataclass(frozen=True)
class Entry:
    hanzi: str
    pinyin: str  # chiffres de ton, ü noté v : "lv4 se4"
    key: str  # sans ton ni espace : "lvse"
    frequency: int


def normalize(text: str) -> str:
    """Ne garde que les lettres : "Ni3 hao3" → "nihao", "lǜ" et "lu:" → "lv"."""
    text = unicodedata.normalize("NFD", text.lower()).replace("ü", "v").replace("u:", "v")
    return re.sub(r"[^a-z]", "", text)


class Dictionary:
    def __init__(self, cedict: Path, frequencies: Path, lexicon: Path):
        self.cedict = cedict
        self.frequencies = frequencies
        self.lexicon = lexicon
        self.by_key: dict[str, list[Entry]] | None = None
        self.keys: list[str] = []
        self.lock = threading.Lock()

    def load(self) -> None:
        with self.lock:
            if self.by_key is None:
                self._load()

    def _load(self) -> None:
        if not self.cedict.is_file():
            raise FileNotFoundError(f"Dictionnaire absent : {self.cedict}")
        frequency: dict[str, int] = {}
        if self.frequencies.is_file():
            for line in self.frequencies.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    frequency[parts[0]] = int(parts[1])

        # La fréquence est celle du caractère, toutes lectures confondues : une lecture autre que
        # la principale (celle du lexique de la synthèse vocale) est rendue plus rare.
        main_reading: dict[str, str] = {}
        if self.lexicon.is_file():
            for line in self.lexicon.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) == 2 and len(parts[0]) == 1:
                    main_reading[parts[0]] = parts[1]

        entries: dict[tuple[str, str], int] = {}
        with self.cedict.open(encoding="utf-8") as lines:
            for line in lines:
                match = CEDICT_LINE.match(line.strip())
                if not match:
                    continue
                hanzi, raw_pinyin, definitions = match.groups()
                syllables = raw_pinyin.lower().replace("u:", "v").split()
                if (
                    not HANZI.match(hanzi)
                    or len(syllables) != len(hanzi)
                    or not all(SYLLABLE.match(s) for s in syllables)
                    # Formes anciennes ou variantes : jamais le bon choix pour un apprenant.
                    or re.match(r"(old |archaic |erhua )?variant of", definitions)
                ):
                    continue
                pinyin = " ".join(syllables).replace("5", "")
                score = frequency.get(hanzi, 0)
                if len(hanzi) == 1:
                    # Un caractère seul en majuscule est un nom de famille : lecture rare.
                    if raw_pinyin[0].isupper():
                        score = 0
                    elif main_reading.get(hanzi, pinyin) != pinyin:
                        score //= 20
                # Une même lecture peut figurer plusieurs fois (nom de famille puis mot courant).
                entries[hanzi, pinyin] = max(score, entries.get((hanzi, pinyin), 0))

        by_key: dict[str, list[Entry]] = {}
        for (hanzi, pinyin), score in entries.items():
            key = re.sub(r"[0-9 ]", "", pinyin)
            by_key.setdefault(key, []).append(Entry(hanzi, pinyin, key, score))
        self.keys = sorted(by_key)
        self.by_key = by_key
        log.info("Dictionnaire de saisie chargé : %d entrées", len(entries))

    def candidates(self, typed: str, preferred: set[tuple[str, str]], limit: int) -> list[dict]:
        """
        Candidats pour le début du pinyin tapé, comme une méthode de saisie : d'abord les mots qui
        couvrent tout le pinyin, puis les mots plus longs qui le prolongent, puis ceux qui n'en
        couvrent que le début. `consumed` = nombre de lettres couvertes par le candidat.
        """
        self.load()
        # `preferred` : (caractères, pinyin normalisé) des mots du vocabulaire.
        rank = lambda e: ((e.hanzi, e.key) not in preferred, -e.frequency, len(e.hanzi))
        results: list[tuple[Entry, int]] = []

        exact = sorted(self.by_key.get(typed, []), key=rank)
        results += [(e, len(typed)) for e in exact]

        start = bisect.bisect_right(self.keys, typed)
        longer: list[Entry] = []
        for key in self.keys[start:]:
            if not key.startswith(typed):
                break
            longer += self.by_key[key]
        # Quelques mots courants qui prolongent la saisie (zhongg → 中国), pas les noms à rallonge.
        longer = [
            e for e in sorted(longer, key=rank)
            if len(e.hanzi) <= 4 and (e.frequency or (e.hanzi, e.key) in preferred)
        ]
        results += [(e, len(typed)) for e in longer[:6]]

        for length in range(len(typed) - 1, 0, -1):
            results += [(e, length) for e in sorted(self.by_key.get(typed[:length], []), key=rank)]
            if len(results) >= limit:
                break

        seen: set[str] = set()
        out = []
        for entry, consumed in results:
            if entry.hanzi in seen:
                continue
            seen.add(entry.hanzi)
            out.append({"hanzi": entry.hanzi, "pinyin": entry.pinyin, "consumed": consumed})
            if len(out) >= limit:
                break
        return out


TTS_MODEL = Path(settings.tts_dir) / "matcha-icefall-zh-baker"
dictionary = Dictionary(
    Path(settings.cedict_path), TTS_MODEL / "dict" / "jieba.dict.utf8", TTS_MODEL / "lexicon.txt"
)


def preload() -> None:
    def run():
        try:
            dictionary.load()
        except Exception:
            log.exception("Saisie des caractères indisponible")

    threading.Thread(target=run, daemon=True).start()
