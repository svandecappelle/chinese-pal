# Déploiement sur un serveur

Une machine Linux (Debian, Ubuntu…), un nom de domaine qui pointe dessus, et trois commandes.

## Prérequis

```bash
sudo apt install -y git make curl openssl nginx certbot
```

Plus Docker (avec `docker compose`) **ou** Podman (avec `podman compose`). Avec Docker, ton
utilisateur doit être dans le groupe `docker` ; ne lance pas `make install` avec `sudo`, le script
l'appelle lui-même pour nginx et certbot.

Le nom de domaine doit déjà pointer vers le serveur (enregistrement DNS A, et AAAA s'il a une IPv6).

## Installation

```bash
git clone git@github.com:svandecappelle/chinese-pal.git
cd chinese-pal
make install DOMAIN=chinois.example.com EMAIL=toi@example.com
```

[install.sh](install.sh) fait, dans l'ordre :

1. **Configuration** : crée `.env` (droits 600) avec le domaine, un mot de passe de base et
   celui du premier administrateur (`ADMIN_USERNAME`, `ADMIN_PASSWORD`), générés. Un `.env`
   existant garde ses valeurs : relancer ne change jamais un secret.
2. **Conteneurs** : construit l'image (le modèle vocal et le dictionnaire sont téléchargés à ce
   moment), démarre, attend que l'application réponde, et vérifie que ni l'application ni
   PostgreSQL n'écoutent ailleurs que sur `127.0.0.1`.
3. **Démarrage au boot** : Docker relance les conteneurs seul ; avec Podman, active
   `podman-restart.service` (et le « linger » de l'utilisateur).
4. **nginx** : configuration port 80, certificat Let's Encrypt par `certbot certonly --webroot`,
   puis configuration HTTPS ([nginx-site.conf.tmpl](nginx-site.conf.tmpl)). Si nginx refuse une
   configuration, le script revient aussitôt à la version port 80 : nginx démarre toujours.
5. **Renouvellement** : le minuteur de certbot renouvelle le certificat ; le port 80 laisse passer
   les vérifications de Let's Encrypt, et nginx est rechargé après chaque renouvellement.
6. **Pare-feu** : seulement avec `FIREWALL=1` (ufw : SSH et nginx).

Options : `SKIP_TLS=1` sert en HTTP sans certificat (derrière un autre proxy qui fait le TLS) ;
`FIREWALL=1` configure ufw.

Relancer `make install` (sans arguments : le domaine est dans `.env`) applique une nouvelle
version de la configuration nginx.

À la fin, connecte-toi avec `admin` et le mot de passe `ADMIN_PASSWORD` de `.env`, change-le
dans « Mon compte », puis crée les comptes dans **Administration**. `ADMIN_PASSWORD` ne sert
qu'à la création du compte : le modifier ensuite dans `.env` n'a aucun effet.

## Mise à jour

```bash
make upgrade
```

[upgrade.sh](upgrade.sh) : sauvegarde de la base, `git pull`, reconstruction, redémarrage
(les migrations s'appliquent au démarrage), nettoyage des anciennes images. Il s'arrête si des
fichiers suivis ont été modifiés sur le serveur, et signale si la configuration nginx a changé.

## Sauvegardes

```bash
make backup                                        # backups/chinese-AAAAMMJJ-HHMMSS.sql.gz
make restore FILE=backups/chinese-20261107-120000.sql.gz
```

Les sauvegardes de plus de 30 jours sont supprimées (`BACKUP_DAYS=60 make backup` pour changer).
`restore` sauvegarde d'abord l'état actuel, puis remplace la base. Pour une sauvegarde
quotidienne, une ligne de `crontab -e` :

```
0 3 * * * cd /chemin/vers/chinese-pal && make backup >/dev/null
```

Pense aussi à copier `backups/` ailleurs que sur le serveur.

Mise à jour depuis une version sans comptes : la progression existante revient au compte
`admin`, créé au redémarrage ; `make upgrade` affiche son mot de passe généré (à noter).

## Application Android

Une fois le site en ligne en HTTPS :

```bash
make apk
```

- **Ce que ça fait** : construit, dans un conteneur, une application Android (Trusted Web Activity)
  qui ouvre `https://DOMAIN` en plein écran avec le Chrome du téléphone, puis la met en
  téléchargement sur `https://DOMAIN/android/chinese-pal.apk` ; un bandeau la propose sur les
  téléphones Android.
- **Outils** : Node, Bubblewrap, JDK 17 et SDK Android sont dans l'image `localhost/chinese-apk`
  ([android/Dockerfile](android/Dockerfile)), rien n'est installé sur le serveur. La première
  construction télécharge environ 1,5 Go ; les suivantes durent une minute ou deux.
- **Fichiers produits** : `downloads/android/chinese-pal.apk` et `info.json`, servis par l'app,
  et `downloads/assetlinks.json`, servi en `/.well-known/assetlinks.json`. Ce dernier prouve à
  Android que l'appli et le site vont ensemble ; sans lui, l'appli affiche une barre d'adresse.
- **Clé de signature** : `android/signing.keystore`, créée à la première construction, avec son
  mot de passe dans `.env` (`ANDROID_KEYSTORE_PASSWORD`). `make backup` copie la clé dans
  `backups/`. **Garde-les aussi ailleurs** que sur le serveur : une
  nouvelle version de l'appli doit être signée avec la même clé, sinon elle ne s'installe pas
  par-dessus l'ancienne (il faudrait désinstaller).
- **Quand reconstruire** : seulement si le nom, l'icône ou le domaine changent ; le contenu vient
  du site. Identifiant Android : le domaine à l'envers (`com.example.chinois.app`), ou
  `ANDROID_PACKAGE` dans `.env` ; ne plus le changer une fois l'appli diffusée.
- **Installation sur le téléphone** : Android demande d'autoriser l'installation depuis le
  navigateur (« sources inconnues ») et Play Protect peut avertir la première fois. Android 7
  minimum, avec Chrome (sinon l'appli s'ouvre dans un onglet du navigateur par défaut). Une
  publication sur le Play Store éviterait ces étapes (le fichier `.aab` est aussi produit, dans
  `android/project/`).
- **Essai avant la mise en ligne** : `ICON_BASE=http://app:8000 APK_NETWORK=chinese_default
  make apk DOMAIN=...` prend icônes et manifeste sur l'app locale (l'APK construit n'ouvrira le
  site qu'une fois celui-ci en ligne sur ce domaine).

## Au quotidien

`make` affiche toutes les commandes : `logs`, `ps`, `restart`, `health`, `shell-db`…

Mot de passe oublié (y compris celui de l'administrateur) : `make password ACCOUNT=identifiant`
en génère un nouveau et ferme les sessions du compte ; si le compte n'existe pas, il est créé
administrateur.

## À savoir

- Le vocabulaire et les exercices publics sont accessibles sans compte ; le reste demande une
  connexion.
  Pour tout réserver, ajoute une authentification HTTP dans nginx (`auth_basic`).
- La base n'est joignable que depuis le serveur (`127.0.0.1:5432`) ; à distance, passe par un
  tunnel SSH : `ssh -L 5432:127.0.0.1:5432 serveur`.
