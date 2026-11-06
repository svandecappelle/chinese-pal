# 汉语 · Révision de vocabulaire chinois

Application web pour réviser du vocabulaire chinois.

- **Backend** : Python 3.13 / FastAPI, accès PostgreSQL via psycopg 3
- **Base** : PostgreSQL 17
- **Frontend** : HTML/CSS/JS sans build, servi par FastAPI

## Démarrer

Avec Docker :

```bash
docker compose up -d --build
```

Avec Podman (via `podman compose`, qui délègue à `docker-compose` ou `podman-compose`) :

```bash
podman compose up -d --build
```

Puis ouvrir http://localhost:8000 (doc de l'API : http://localhost:8000/docs).

Arrêter : `docker compose down` / `podman compose down`.
Repartir d'une base vide : ajouter `-v` pour supprimer le volume.

## Configuration

Les valeurs par défaut fonctionnent telles quelles. Pour les changer (ports, identifiants), copier
`.env.example` en `.env` et l'éditer.

## Base de données

Les migrations sont des fichiers SQL dans `backend/app/migrations/` (`NNN_description.sql`).
Au démarrage, l'application applique dans l'ordre celles qui ne figurent pas encore dans la table
`schema_migrations`. Pour faire évoluer le schéma : ajouter un nouveau fichier, ne jamais modifier
un fichier déjà appliqué.

Accès direct à la base :

```bash
docker compose exec db psql -U chinese
```

## Fonctionnement des révisions

- Une **carte** = un mot + un mode de révision :
  - auto-évalués : 汉字 → sens, pinyin → 汉字 + sens, écoute → 汉字 + sens, sens → 汉字 ;
  - saisie vérifiée automatiquement : 汉字 → pinyin, sens → pinyin. Le pinyin se tape avec des
    chiffres (`ni3 hao3` → `nǐ hǎo`, `lv4` → `lǜ`, ton neutre sans chiffre) ou directement avec
    accents ; une réponse aux bonnes syllabes mais aux tons faux est signalée comme telle
    ([pinyin.js](backend/app/static/js/pinyin.js)).
- **Répétition espacée** ([srs.py](backend/app/srs.py)) : variante de SM-2 à 4 boutons
  (À revoir / Difficile / Bien / Facile, raccourcis `Espace` puis `1`–`4`). La progression d'une
  carte est commune à tous les exercices.
- Un **exercice** choisit ses mots (tout le vocabulaire, des listes entières et/ou des mots
  choisis un par un), un ou plusieurs modes de révision et un nombre de nouvelles cartes par jour.
  Une session contient les cartes dues + les nouvelles cartes du jour.
- Le « jour » est calculé en UTC.

## Prononciation, ordre des traits, exemples

- **Audio** : synthèse vocale intégrée au serveur ([tts.py](backend/app/tts.py)), avec
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) et le modèle chinois Matcha « baker ».
  Le modèle est téléchargé à la construction de l'image (~130 Mo), puis tout fonctionne hors
  ligne, sans rien installer dans le navigateur. Chaque son est généré une fois (0,1 à 0,3 s) puis
  gardé dans la table `tts_cache`. Pour un caractère seul, la lecture est imposée par le pinyin du
  mot (长 cháng / zhǎng) ; les mots et les phrases sont lus par le modèle, qui applique les
  changements de ton (不是 bú shì). Le modèle ne connaît pas « shéi » : 谁 est lu shuí.
  Le jeu de données de cette voix est réservé à un usage non commercial.
  Si le serveur ne peut pas parler, le navigateur utilise sa propre voix chinoise s'il en a une.
- **Ordre des traits** : [Hanzi Writer](https://hanziwriter.org) (MIT), chargé depuis le CDN
  jsDelivr, avec animation et entraînement au tracé dans la fiche d'un mot
  ([strokes.js](backend/app/static/js/strokes.js)). Nécessite une connexion Internet.
- **Exemples** : une phrase par mot HSK (avec pinyin et traduction), affichée avec la réponse.
  On peut en ajouter ou en supprimer depuis la fiche d'un mot (clic sur une ligne du vocabulaire).

## Interface

- Tableaux paginés (10 à 100 lignes), triables par colonne et filtrables ; la page, le tri et
  les filtres sont gardés le temps de l'onglet. `/` place le curseur dans la recherche.
- Clic sur un mot du vocabulaire : fiche avec prononciation, traits et exemples.
- En révision : `A` écoute, `T` ordre des traits, `Entrée` valide la note suggérée, case
  « 🔊 auto » pour prononcer chaque réponse.

## Listes prêtes à importer

Dans **Vocabulaire**, les listes HSK 1 à 3 (HSK 2.0, ~600 mots avec traductions françaises et
une phrase d'exemple par mot) s'importent en un clic. « Compléter » ajoute ce qui manque à une
liste déjà importée. L'import est rejouable sans doublon : un mot déjà présent est simplement
rattaché à la liste (un mot peut appartenir à plusieurs listes) et garde sa traduction.
Sources et licence : [backend/app/data/README.md](backend/app/data/README.md).

## Structure

```
compose.yaml
backend/
  Dockerfile
  requirements.txt
  app/
    main.py          création de l'app, service du frontend
    srs.py           algorithme de répétition espacée
    tts.py           synthèse vocale (prononciation)
    db.py            pool de connexions, migrations
    config.py        configuration (variables d'environnement)
    routers/         routes API (vocabulaire, exercices, révisions, prononciation)
    data/            listes importables (HSK) et leurs phrases d'exemple
    migrations/      scripts SQL versionnés
    static/          frontend
      js/api.js      appels API, libellés des modes
      js/pinyin.js   conversion et vérification du pinyin
      js/audio.js    lecture de l'audio de prononciation
      js/strokes.js  ordre des traits (Hanzi Writer)
      js/ui.js       notifications, pagination
      js/views/      écrans (exercices, éditeur, révision, vocabulaire, fiche d'un mot)
```
