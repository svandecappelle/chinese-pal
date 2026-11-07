"""Classificateurs (量词) : 一本书, 两只猫… Celui d'un nom s'apprend avec lui."""

import random
import re
import unicodedata

from .ime import dictionary

# Pinyin des classificateurs courants (ceux des listes HSK et quelques autres).
PINYIN = {
    "个": "gè", "件": "jiàn", "份": "fèn", "位": "wèi", "副": "fù", "匹": "pǐ", "双": "shuāng",
    "只": "zhī", "台": "tái", "名": "míng", "场": "chǎng", "块": "kuài", "壶": "hú", "处": "chù",
    "套": "tào", "家": "jiā", "对": "duì", "封": "fēng", "层": "céng", "幅": "fú", "座": "zuò",
    "张": "zhāng", "所": "suǒ", "扇": "shàn", "把": "bǎ", "支": "zhī", "本": "běn", "朵": "duǒ",
    "束": "shù", "条": "tiáo", "杯": "bēi", "架": "jià", "栋": "dòng", "根": "gēn", "棵": "kē",
    "次": "cì", "段": "duàn", "片": "piàn", "瓶": "píng", "盏": "zhǎn", "盘": "pán", "种": "zhǒng",
    "笔": "bǐ", "艘": "sōu", "节": "jié", "辆": "liàng", "道": "dào", "部": "bù", "门": "mén",
    "间": "jiān", "顶": "dǐng", "项": "xiàng", "颗": "kē", "首": "shǒu", "头": "tóu", "口": "kǒu",
    "句": "jù", "粒": "lì", "群": "qún", "篇": "piān", "碗": "wǎn", "盒": "hé", "包": "bāo",
    "斤": "jīn", "岁": "suì", "届": "jiè", "轮": "lún", "株": "zhū",
}

# Fausses pistes proposées dans le mode de révision : les classificateurs les plus fréquents.
COMMON = ["个", "本", "只", "张", "条", "件", "位", "家", "辆", "双", "把", "台", "杯", "块",
          "座", "支", "部", "封", "朵", "棵", "所", "间", "场", "次", "节", "份"]
CHOICE_COUNT = 4


TONE_MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}


def with_tone_marks(numbered: str) -> str:
    """« ce4 » → « cè » (même règle de placement que pinyin.js)."""

    def mark(match: re.Match) -> str:
        letters, tone = match.group(1).replace("v", "ü"), int(match.group(2))
        vowels = list(re.finditer(r"[aeiouü]+", letters))
        if not 1 <= tone <= 4 or not vowels:
            return letters
        cluster = vowels[-1]
        offset = next((i for i, c in enumerate(cluster.group()) if c in "ae"), -1)
        if offset < 0:
            offset = cluster.group().find("ou")
        if offset < 0:
            offset = len(cluster.group()) - 1
        pos = cluster.start() + offset
        return letters[:pos] + TONE_MARKS[letters[pos]][tone - 1] + letters[pos + 1:]

    return re.sub(r"([a-zü]+)([0-5])", mark, numbered)


def pinyin_of(classifier: str) -> str:
    if classifier in PINYIN:
        return PINYIN[classifier]
    try:
        reading = dictionary.reading_of(classifier)
    except FileNotFoundError:
        reading = None
    return with_tone_marks(reading) if reading else ""


def described(classifier: str) -> dict:
    return {"hanzi": classifier, "pinyin": pinyin_of(classifier)}


def one(classifier_pinyin: str) -> str:
    """Ton de 一 devant un classificateur : yí devant un 4e ton, yì sinon (一个 yí gè, 一本 yì běn)."""
    fourth = "̀" in unicodedata.normalize("NFD", classifier_pinyin)
    return "yí" if fourth else "yì"


def measure(hanzi: str, pinyin: str, classifiers: list[str]) -> dict | None:
    """« 一本书 » avec son pinyin, pour le premier classificateur du mot."""
    if not classifiers:
        return None
    first = described(classifiers[0])
    spoken = " ".join(p for p in [one(first["pinyin"]), first["pinyin"], pinyin] if p)
    return {"hanzi": f"一{first['hanzi']}{hanzi}", "pinyin": spoken}


def choices(classifiers: list[str]) -> list[dict]:
    """Le classificateur du mot parmi d'autres courants, qui ne lui conviennent pas, mélangés."""
    others = [c for c in COMMON if c not in classifiers]
    picked = [classifiers[0], *random.sample(others, CHOICE_COUNT - 1)]
    random.shuffle(picked)
    return [described(c) for c in picked]
