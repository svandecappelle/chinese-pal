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

Au premier démarrage, l'application crée le compte administrateur `admin` et écrit son mot de
passe dans le journal : `docker compose logs app` (ou `podman compose logs app`). Pour choisir
ce mot de passe, mettre `ADMIN_PASSWORD=...` dans `.env` avant le premier démarrage. Oublié :
`make password ACCOUNT=admin` en génère un nouveau.

Arrêter : `docker compose down` / `podman compose down`.
Repartir d'une base vide : ajouter `-v` pour supprimer le volume.

Avec `make` (Linux, macOS) : `make up`, `make logs`, `make backup`… ; `make` seul liste tout.

## Mettre en ligne

Sur un serveur avec un nom de domaine, une commande installe tout (conteneurs, nginx,
certificat HTTPS, démarrage au boot) et une autre met à jour :

```bash
make install DOMAIN=chinois.example.com EMAIL=toi@example.com
make upgrade
```

Détails, sauvegardes et prérequis : [deploy/README.md](deploy/README.md).

## Configuration

Les valeurs par défaut fonctionnent telles quelles. Pour les changer (ports, identifiants), copier
`.env.example` en `.env` et l'éditer.

## Comptes et droits

Le vocabulaire et les exercices **publics** se consultent et se révisent sans compte ; le reste
(exercices d'une classe, modifications) demande de se connecter. Il n'y a
pas d'inscription : les comptes sont créés dans **Administration** (un mot de passe est généré et
affiché une fois ; chacun le change ensuite dans « Mon compte »).

Les **droits** sont portés par les **groupes** ; un administrateur les a tous :

| Droit | Permet |
|---|---|
| Ajouter et modifier le vocabulaire | mots, listes, exemples, classificateurs, import des listes HSK |
| Créer des exercices et les attribuer | créer ses exercices, les attribuer à des groupes, suivre les élèves |
| Gérer les comptes et les groupes | écran Administration (seul un administrateur nomme un administrateur) |

Deux groupes existent au départ : **Professeurs** (vocabulaire + exercices) et **Élèves** (aucun
droit). Un groupe sert aussi de **classe** : un professeur attribue son exercice (son « cours »)
à des groupes, ou à tous les comptes, et ses membres le voient dans leurs exercices. Chacun a sa
propre progression ; l'auteur suit celle de ses élèves (bouton **Suivi**). Seul l'auteur d'un
exercice (ou un administrateur) peut le modifier.

**Exercices publics** : la case « Public » de l'éditeur rend un exercice révisable par n'importe
qui, sans compte. À sa première réponse, le visiteur reçoit un compte invité invisible, tenu par
un cookie (un an, prolongé à chaque visite) : sa progression reste dans ce navigateur. S'il se
connecte ensuite, elle rejoint son compte (en cas de doublon, celle du compte l'emporte). Le
suivi de l'auteur compte ces visiteurs sans les nommer.

Sécurité : mots de passe hachés avec scrypt, session dans un cookie `HttpOnly` / `SameSite=Lax`
(`Secure` derrière HTTPS), 30 jours glissants ; trop d'échecs de connexion bloquent l'identifiant
15 minutes. Changer son mot de passe déconnecte ses autres appareils ; désactiver un compte le
déconnecte aussitôt et garde sa progression.

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
  - classificateur : on voit un nom (一 ？ 书) et on choisit le bon classificateur parmi quatre ;
    seuls les mots qui en ont un forment des cartes ;
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

## Classificateurs

Chaque nom peut avoir ses classificateurs (量词 : 一**本**书, 一**只**猫), affichés avec la réponse en
révision, dans la fiche du mot (où on les modifie) et dans le tableau du vocabulaire, sous la forme
« 一本书 *yì běn shū* » (ton de 一 adapté au classificateur). Ceux des 146 noms HSK concernés ont
été relus à la main ([classificateurs.tsv](backend/app/data/classificateurs.tsv)) et s'ajoutent à
l'import des listes (« Compléter » pour une liste déjà importée) ; un mot ajouté à la main reçoit
ceux qu'indique CC-CEDICT ([classifiers.py](backend/app/classifiers.py)).

## Claviers chinois

Les champs où l'on écrit du chinois ont un bouton qui ouvre un clavier en bas de l'écran
([keyboard.js](backend/app/static/js/keyboard.js)) :

- **汉 (caractères)** : on tape le pinyin sans tons (`nihao`, `zhongg`…) et on choisit parmi les
  caractères proposés (`Espace` = premier, `1`–`9`, `-` / `=` pour changer de page, `Entrée` garde
  les lettres, `Échap` ferme). Le pinyin non couvert reste à convertir (`nihaoma` → 你好, puis
  « ma »). La ponctuation devient chinoise (`,` → `，`, `.` → `。`). Les candidats viennent de
  [CC-CEDICT](https://cc-cedict.org) (CC BY-SA 4.0, téléchargé à la construction de l'image),
  classés par fréquence d'usage, les mots du vocabulaire de l'app en premier
  ([ime.py](backend/app/ime.py)).
- **ǎ (pinyin)** : boutons des quatre tons et du ton neutre, appliqués à la syllabe qui précède le
  curseur (`hao` + ǎ → `hǎo`, en remplaçant un ton déjà mis), et voyelles accentuées. Clavier
  ouvert, un chiffre tapé après une syllabe devient son ton (`ni3` → `nǐ`).

Les deux claviers fonctionnent aussi sur téléphone, sans clavier physique.

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
Makefile           commandes (make install, make upgrade, make backup…)
deploy/            installation serveur : scripts, modèles nginx
backend/
  Dockerfile
  requirements.txt
  app/
    main.py          création de l'app, service du frontend
    auth.py          comptes : mots de passe, sessions, droits, premier administrateur
    cli.py           commandes d'exploitation (make password)
    srs.py           algorithme de répétition espacée
    tts.py           synthèse vocale (prononciation)
    ime.py           caractères candidats pour un pinyin (clavier 汉)
    classifiers.py   classificateurs : pinyin, « 一本书 », choix du mode de révision
    db.py            pool de connexions, migrations
    config.py        configuration (variables d'environnement)
    routers/         routes API (compte, administration, vocabulaire, exercices, révisions,
                     prononciation, saisie)
    data/            listes importables (HSK) et leurs phrases d'exemple
    migrations/      scripts SQL versionnés
    static/          frontend
      js/api.js      appels API, libellés des modes
      js/session.js  utilisateur connecté et ses droits
      js/pinyin.js   conversion et vérification du pinyin
      js/keyboard.js claviers à l'écran (caractères, pinyin)
      js/audio.js    lecture de l'audio de prononciation
      js/strokes.js  ordre des traits (Hanzi Writer)
      js/ui.js       notifications, pagination
      js/views/      écrans (exercices, éditeur, révision, suivi, vocabulaire, fiche d'un mot,
                     connexion, compte, administration)
```
