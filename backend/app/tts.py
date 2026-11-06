"""Synthèse vocale du mandarin hors ligne : sherpa-onnx avec le modèle Matcha « baker ».

Le modèle lit le texte grâce à un lexique mot → pinyin. Un caractère seul n'a pas de contexte
pour choisir sa lecture (长 cháng / zhǎng) : on peut alors imposer le pinyin connu du mot.
Pour cela, chaque syllabe du modèle reçoit un caractère de la zone privée Unicode, ajouté au
lexique avec cette seule lecture.
"""

import io
import logging
import re
import tempfile
import threading
import unicodedata
import wave
from array import array
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)

# Identifie la voix dans le cache : à changer avec le modèle ou les réglages.
VOICE = "matcha-baker-0.9"
SPEED = 0.9

TONE_MARKS = {"̄": "1", "́": "2", "̌": "3", "̀": "4"}
# Syllabes du lexique absentes du modèle, remplacées par une lecture équivalente.
MISSING_SYLLABLES = {"shei2": "shui2"}


class Unavailable(Exception):
    pass


def pinyin_syllable(pinyin: str) -> str:
    """« cháng » → « chang2 », « lǜ » → « lv4 », « le » → « le » (ton neutre sans chiffre)."""
    decomposed = unicodedata.normalize("NFD", pinyin.strip().lower())
    tone = next((TONE_MARKS[c] for c in decomposed if c in TONE_MARKS), "")
    base = "".join(c for c in decomposed if c not in TONE_MARKS).replace("ü", "v")
    return base + tone


class Synthesizer:
    def __init__(self, root: Path):
        self.root = root
        self.tts = None
        self.syllables: dict[str, str] = {}
        self.lock = threading.Lock()

    def load(self) -> None:
        with self.lock:
            if self.tts is None:
                self.tts = self._create()

    def _create(self):
        import sherpa_onnx

        model = self.root / "matcha-icefall-zh-baker"
        vocoder = self.root / "vocos-22khz-univ.onnx"
        if not model.is_dir() or not vocoder.is_file():
            raise Unavailable(f"Modèle de synthèse vocale absent de {self.root}")

        tokens = (model / "tokens.txt").read_text(encoding="utf-8").splitlines()
        names = [line.split()[0] for line in tokens if re.match(r"[a-z]+[1-4]? ", line)]
        self.syllables = {name: chr(0xE000 + i) for i, name in enumerate(names)}

        lexicon = (model / "lexicon.txt").read_text(encoding="utf-8")
        for missing, replacement in MISSING_SYLLABLES.items():
            lexicon = re.sub(rf"\b{missing}\b", replacement, lexicon)
        lexicon += "".join(f"{char} {name}\n" for name, char in self.syllables.items())
        lexicon_file = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", suffix=".txt", delete=False
        )
        with lexicon_file:
            lexicon_file.write(lexicon)

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(
                    acoustic_model=str(model / "model-steps-3.onnx"),
                    vocoder=str(vocoder),
                    lexicon=lexicon_file.name,
                    tokens=str(model / "tokens.txt"),
                    dict_dir=str(model / "dict"),
                ),
                num_threads=2,
            ),
            rule_fsts=",".join(str(model / f) for f in ["phone.fst", "date.fst", "number.fst"]),
        )
        log.info("Chargement du modèle de synthèse vocale...")
        return sherpa_onnx.OfflineTts(config)

    def reading(self, text: str, pinyin: str | None) -> str:
        """Syllabe à imposer : seulement pour un caractère seul dont le pinyin est connu."""
        if not pinyin or len(text) != 1:
            return ""
        self.load()
        syllable = pinyin_syllable(pinyin)
        syllable = MISSING_SYLLABLES.get(syllable, syllable)
        return syllable if syllable in self.syllables else ""

    def synthesize(self, text: str, reading: str = "") -> bytes:
        """Renvoie un fichier WAV (mono, 16 bits)."""
        self.load()
        with self.lock:
            audio = self.tts.generate(self.syllables[reading] if reading else text, sid=0, speed=SPEED)
        if not len(audio.samples):
            raise ValueError("Aucun son produit pour ce texte")
        pcm = array("h", (int(max(-1.0, min(1.0, s)) * 32767) for s in audio.samples))
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(audio.sample_rate)
            out.writeframes(pcm.tobytes())
        return buffer.getvalue()


synthesizer = Synthesizer(Path(settings.tts_dir))


def preload() -> None:
    """Charge le modèle en arrière-plan au démarrage pour que la première écoute soit rapide."""

    def run():
        try:
            synthesizer.load()
        except Exception:
            log.exception("Synthèse vocale indisponible")

    threading.Thread(target=run, daemon=True).start()
