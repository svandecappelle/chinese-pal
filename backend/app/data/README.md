# Listes de vocabulaire importables

Un fichier `<id>.tsv` par liste (colonnes `hanzi`, `pinyin`, `traduction`, séparées par des
tabulations), déclaré dans `PACKS` de [routers/vocab.py](../routers/vocab.py).

## HSK 1 à 3 (`hsk1.tsv`, `hsk2.tsv`, `hsk3.tsv`)

Listes officielles HSK 2.0 (150 + 147 + 298 mots). Les caractères et le pinyin proviennent de
[complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary)
(`wordlists/exclusive/old/`), sous licence MIT :

> Copyright (c) 2026 Yanis Zafirópulos
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions: The above copyright notice
> and this permission notice shall be included in all copies or substantial portions of the
> Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

Pour les caractères à plusieurs lectures, la lecture retenue est celle du HSK (了 le, 得 de,
长 cháng…). Les traductions françaises ont été rédigées pour ce projet.

## Phrases d'exemple (`hsk1_exemples.tsv`, `hsk2_exemples.tsv`, `hsk3_exemples.tsv`)

Une phrase par mot (colonnes `hanzi` du mot, `phrase`, `pinyin`, `traduction`), rédigées pour ce
projet. Le pinyin suit les tons de citation (不 bù, 一 yī), sans les modifications de ton à l'oral.
