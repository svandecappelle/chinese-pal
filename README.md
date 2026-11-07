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

Un exercice se lance de deux façons :

- **Réviser** : sans pression, les mots défilent un par un avec leurs caractères, leur pinyin,
  leur sens, leur prononciation, leur classificateur et une phrase d'exemple. Rien n'est noté.
  `←` / `→` ou `Espace` (glisser sur téléphone), défilement automatique (3 à 12 s par mot),
  mélange, prononciation automatique. **Travailler** choisit ce qu'on révise : tout voir, le sens,
  les caractères, le pinyin, l'écoute (le mot est seulement prononcé), le tracé (ordre des traits
  animé puis tracé sur le modèle) ou le classificateur (mots qui en ont un). La partie travaillée
  reste cachée jusqu'au clic, `Espace` ou `→`, puis le mot suivant arrive.
- **Test** : chaque carte attend une réponse, vérifiée puis notée pour la répétition espacée.

Une **carte** = un mot + un mode. Ce que l'élève fournit en test :

| Mode | Réponse |
|---|---|
| 汉字 → sens, pinyin → sens, écoute → sens | le sens tapé en français ; un des sens suffit, accents, articles et précisions entre parenthèses facultatifs, une faute de frappe est tolérée ([answers.js](backend/app/static/js/answers.js)) |
| sens → 汉字, écoute → 汉字 (dictée tracée) | les caractères **tracés** trait par trait, sans modèle, dans l'ordre des traits (Hanzi Writer) ; après 3 essais ratés le trait attendu clignote, « Je ne sais pas » montre la réponse |
| 汉字 → pinyin, sens → pinyin, écoute → pinyin (dictée) | le pinyin tapé avec les tons : chiffres (`ni3 hao3` → `nǐ hǎo`, `lv4` → `lǜ`, ton neutre sans chiffre) ou accents ; bonnes syllabes mais tons faux signalés ([pinyin.js](backend/app/static/js/pinyin.js)) |
| classificateur | le bon classificateur parmi quatre (一 ？ 书) ; seuls les mots qui en ont un forment des cartes |
| écoute → tons | le ton de chaque syllabe entendue (boutons ou touches `1`–`4`, `5` neutre) ; ce sont les tons écrits, sans les changements de ton de l'oral (你好 s'entend « ní hǎo », s'écrit nǐ hǎo). Le pinyin est aligné sur les caractères grâce à CC-CEDICT ([drills.py](backend/app/drills.py)) |
| phrase à trous | le mot manquant de la phrase d'exemple parmi quatre, la traduction de la phrase étant donnée ; les autres choix ne partagent pas de classificateur avec le mot (pour éviter 一只狗 / 一只猫) |
| phrase à remettre dans l'ordre | les mots de la phrase d'exemple, mélangés, à cliquer dans l'ordre (ou leur numéro, `⌫` pour retirer) ; découpage en mots par le dictionnaire, le mot révisé restant d'un seul tenant. Une phrase de moins de 3 mots devient une phrase à trous |
| dictée de phrase | la phrase d'exemple entendue, tapée en caractères avec le clavier 汉 ; ponctuation facultative, les caractères manquants ou faux sont surlignés (presque juste à 75 % → Difficile) |

Les modes sur les phrases ne concernent que les mots qui ont une phrase d'exemple qui les contient.

Quand le mot présenté est en chinois (ou que la réponse n'est pas sa prononciation), un bouton 🔊
(touche `A`) permet de l'entendre. La note est **suggérée** d'après la réponse (sans faute → Bien,
quelques erreurs de tracé → Difficile, faux → À revoir) ; l'élève peut en choisir une autre,
utile quand la vérification souple du sens se trompe.

- **Répétition espacée** ([srs.py](backend/app/srs.py)) : variante de SM-2 à 4 boutons
  (À revoir / Difficile / Bien / Facile, `Entrée` valide la note suggérée, `1`–`4` en choisit une).
  La progression d'une carte est commune à tous les exercices.
- Un **exercice** choisit ses mots (tout le vocabulaire, des listes entières et/ou des mots
  choisis un par un), un ou plusieurs modes de révision et un nombre de nouvelles cartes par jour.
  Un test contient les cartes dues + les nouvelles cartes du jour. Si l'exercice a plusieurs
  modes, l'élève choisit avant de commencer ce qu'il travaille (tracé, pinyin, tons…), avec le
  nombre de cartes de chacun ; le choix est mémorisé par exercice et se change en cours de test.
- **Mes statistiques** (onglet **Statistiques**, pour un compte ou un invité) : jours d'affilée
  (série en cours et meilleure), calendrier des réponses sur un an, réussite par mode sur 30 jours,
  mots vus et maîtrisés (toutes leurs cartes à 21 jours ou plus), et les 20 mots les plus ratés
  sur 90 jours. Ces mots se retravaillent en mode révision (« Retravailler ces mots ») ou se
  remettent « à revoir » pour le prochain test (seulement dans les modes où ils ont été ratés).
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
- **Fiches d'écriture** (onglet **Fiches**, ou « ✍ Fiches » sur un exercice et dans le
  vocabulaire) : des fiches A4 à imprimer
  ([writing.js](backend/app/static/js/views/writing.js)). On choisit des mots d'un exercice ou
  d'une liste (les 30 premiers cochés d'office), et/ou des caractères personnalisés tapés avec le
  clavier chinois 汉 ; pour ceux qui ne sont pas dans le vocabulaire, le pinyin vient de
  CC-CEDICT (`GET /api/ime/lectures`). Pour chaque caractère,
  la fiche montre l'ordre des traits pas à pas (le trait ajouté en rouge), un modèle, des modèles
  grisés à repasser puis des cases vides. Réglages : quadrillage 田字格, 米字格 ou cases vides,
  taille des cases (12, 16 ou 20 mm), nombre de modèles grisés et de lignes, pinyin et sens
  affichés ou non (pour une dictée), caractères répétés ou non. Les tracés viennent des données de
  Hanzi Writer ; sans connexion, les caractères sont écrits avec la police, sans les étapes.
- **Lecture assistée** (onglet **Lecture**) : on colle ou tape un texte chinois ; il est découpé
  en mots d'après CC-CEDICT (le plus long mot connu d'abord), avec le pinyin au-dessus
  ([reading.js](backend/app/static/js/views/reading.js), `POST /api/ime/lecture`). Toucher un mot
  montre son sens : celui du vocabulaire (en français) s'il y est, sinon celui de CC-CEDICT (en
  anglais). Les mots hors vocabulaire sont soulignés et listés ; avec le droit de gérer le
  vocabulaire, on les y ajoute en donnant leur sens en français. Les noms propres (小明) sont
  découpés caractère par caractère.
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
- En révision comme en test : `A` écoute, `T` ordre des traits, case « 🔊 auto » pour prononcer
  chaque mot (en test : quand la réponse s'affiche).

## Listes prêtes à importer

Dans **Vocabulaire**, les listes s'importent en un clic, chacune avec ses traductions
françaises, une phrase d'exemple par mot et les classificateurs des noms :

- **HSK** : niveaux 1 à 3 (HSK 2.0, ~600 mots) ;
- **Thèmes** : animaux, temps et calendrier, météo, activités et loisirs, sports, pays et
  nationalités, famille, corps et santé, nourriture et boissons, métiers, transports et ville,
  vêtements et couleurs (~30 mots chacune).

Une liste importée devient une liste de vocabulaire ordinaire : on en fait un exercice en la
choisissant dans l'éditeur d'exercice. « Compléter » ajoute ce qui manque à une
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
    drills.py        tons d'un mot, phrases découpées en mots, phrases à trous (modes de test)
    classifiers.py   classificateurs : pinyin, « 一本书 », choix du mode de révision
    db.py            pool de connexions, migrations
    config.py        configuration (variables d'environnement)
    routers/         routes API (compte, administration, vocabulaire, exercices, révisions,
                     statistiques, prononciation, saisie et lecture assistée)
    data/            listes importables (HSK) et leurs phrases d'exemple
    migrations/      scripts SQL versionnés
    static/          frontend
      js/api.js      appels API, libellés des modes
      js/session.js  utilisateur connecté et ses droits
      js/pinyin.js   conversion et vérification du pinyin
      js/keyboard.js claviers à l'écran (caractères, pinyin)
      js/audio.js    lecture de l'audio de prononciation
      js/strokes.js  ordre des traits (Hanzi Writer) : animation et tracé
      js/answers.js  vérification souple d'un sens tapé
      js/ui.js       notifications, pagination
      js/views/      écrans (exercices, éditeur, révision, test, suivi, vocabulaire, fiche d'un mot,
                     fiches d'écriture, statistiques, lecture assistée, connexion, compte,
                     administration)
```
