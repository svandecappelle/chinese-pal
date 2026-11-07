#!/usr/bin/env bash
#
# Installation sur un serveur : secrets, conteneurs, démarrage au boot, nginx, certificat HTTPS.
#
#   make install DOMAIN=chinois.example.com EMAIL=toi@example.com
#
# Relançable sans risque : un .env existant garde ses valeurs, un certificat existant est
# réutilisé. Le relancer applique aussi une nouvelle version de la configuration nginx.
#
# Options (variables d'environnement) :
#   SKIP_TLS=1   HTTP seulement, sans certificat (derrière un autre proxy qui fait le TLS)
#   FIREWALL=1   configure ufw (SSH + nginx uniquement)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN="${DOMAIN:-$(env_value DOMAIN "")}"
EMAIL="${EMAIL:-}"
SKIP_TLS="${SKIP_TLS:-0}"
FIREWALL="${FIREWALL:-0}"

# ---------------------------------------------------------------- vérifications

[ -n "$DOMAIN" ] || die "DOMAIN est obligatoire : make install DOMAIN=chinois.example.com EMAIL=toi@example.com"
need curl
need openssl

# Le démon Docker : sans lui, l'échec arriverait plus loin avec un message obscur.
if [ "$RUNTIME" = "docker" ] && ! docker info >/dev/null 2>&1; then
  die "impossible de joindre le démon Docker en tant que $(id -un).

       Ne relance PAS avec sudo : .env et backups/ appartiendraient à root. Le script
       appelle sudo lui-même pour nginx et certbot. Ajoute-toi plutôt au groupe docker :

         sudo usermod -aG docker $(id -un) && newgrp docker"
fi

bold "Installation de 汉语 · Révision de vocabulaire chinois"
info "domaine : $DOMAIN"
info "moteur :  $COMPOSE"
info "dossier : $ROOT"

# ---------------------------------------------------------------- 1. configuration

step "1/6  Configuration (.env)"

if [ -f .env ]; then
  info ".env existe : ses valeurs sont gardées"
else
  : > .env
  chmod 600 .env
  info ".env créé"
fi

# N'ajoute une clé que si elle est absente : relancer ne change jamais un secret.
ensure() {
  local key="$1" value="$2" note="${3:-}"
  grep -qE "^${key}=" .env && return 0
  [ -n "$note" ] && printf '\n# %s\n' "$note" >> .env
  printf '%s=%s\n' "$key" "$value" >> .env
  info "$key ajouté"
}

ensure DOMAIN "$DOMAIN" "Nom de domaine public (utilisé par make install et make upgrade)."

# PostgreSQL ne lit POSTGRES_PASSWORD qu'à la création de la base : sur une base existante,
# un nouveau mot de passe empêcherait l'app de s'y connecter. On garde alors l'ancien défaut.
if grep -qE '^POSTGRES_PASSWORD=' .env; then
  :
elif $RUNTIME volume inspect chinese_pgdata >/dev/null 2>&1; then
  ensure POSTGRES_PASSWORD "chinese" "Mot de passe de la base (déjà créée avec la valeur par défaut)."
  warn "la base existait déjà : mot de passe par défaut conservé (la base n'est joignable que"
  warn "depuis ce serveur). Pour le changer : make shell-db, puis ALTER USER, puis .env."
else
  # Hexadécimal : un / ou un + dans le mot de passe casserait l'URL de connexion.
  ensure POSTGRES_PASSWORD "$(openssl rand -hex 24)" "Mot de passe de la base, généré à l'installation."
fi
ensure APP_PORT "8000" "Port local de l'application (nginx le relaie ; jamais exposé directement)."

# ---------------------------------------------------------------- 2. conteneurs

step "2/6  Construction et démarrage"
$COMPOSE up -d --build
wait_healthy
info "application prête sur 127.0.0.1:$APP_PORT"

# Ce qui écoute vraiment, plutôt que ce que la configuration prétend.
if command -v ss >/dev/null 2>&1; then
  exposed="$(ss -ltnH 2>/dev/null | awk '{print $4}' \
    | grep -E ":($APP_PORT|$(env_value DB_PORT 5432))\$" | grep -vE '^(127\.0\.0\.1|\[::1\])' || true)"
  [ -z "$exposed" ] || die "ces ports écoutent au-delà de 127.0.0.1 : $exposed. Corrige compose.yaml avant d'ouvrir le serveur."
  info "seul nginx sera exposé"
fi

# ---------------------------------------------------------------- 3. démarrage au boot

step "3/6  Redémarrage automatique"
if [ "$RUNTIME" = "docker" ]; then
  if command -v systemctl >/dev/null 2>&1 && ! systemctl is-enabled docker >/dev/null 2>&1; then
    sudo systemctl enable docker
  fi
  info "Docker relance les conteneurs au démarrage (restart: unless-stopped)"
elif command -v systemctl >/dev/null 2>&1; then
  # Podman sans démon : c'est podman-restart.service qui relance les conteneurs
  # « restart: unless-stopped » au boot. En mode utilisateur, il faut aussi le « linger »
  # pour que les services de l'utilisateur démarrent sans qu'il soit connecté.
  if [ "$(id -u)" = "0" ]; then
    systemctl enable podman-restart.service >/dev/null 2>&1 || warn "podman-restart.service introuvable"
  else
    sudo loginctl enable-linger "$(id -un)"
    systemctl --user enable podman-restart.service >/dev/null 2>&1 \
      || warn "podman-restart.service introuvable : les conteneurs ne redémarreront pas seuls au boot"
  fi
  info "les conteneurs repartiront au démarrage du serveur"
else
  warn "systemd absent : pense à relancer « make up » après un redémarrage"
fi

# ---------------------------------------------------------------- 4. nginx

step "4/6  nginx"
SITE=/etc/nginx/sites-available/chinese
ENABLED=/etc/nginx/sites-enabled/chinese
WEBROOT=/var/www/html

render() {
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$APP_PORT|g" -e "s|__WEBROOT__|$WEBROOT|g" "$1" \
    | sudo tee "$SITE" >/dev/null
}

# Une configuration refusée par nginx resterait en place et empêcherait nginx de redémarrer
# (au prochain reboot : plus de site du tout). On revient donc aussitôt à la version port 80.
apply() {
  render "$1"
  sudo ln -sf "$SITE" "$ENABLED"
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
    return 0
  fi
  warn "nginx refuse cette configuration :"
  sudo nginx -t 2>&1 | sed 's/^/      /' >&2
  render deploy/nginx-bootstrap.conf.tmpl
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
  die "retour à la configuration port 80 : nginx démarre toujours."
}

CERT_READY=0
if ! command -v nginx >/dev/null 2>&1; then
  warn "nginx n'est pas installé : étape sautée. sudo apt install -y nginx certbot, puis relance."
else
  sudo mkdir -p "$WEBROOT"
  if [ "$SKIP_TLS" = "1" ]; then
    warn "SKIP_TLS=1 : HTTP seulement, sans certificat"
    apply deploy/nginx-plain.conf.tmpl
  elif sudo test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
    info "certificat existant pour $DOMAIN"
    apply deploy/nginx-site.conf.tmpl
    CERT_READY=1
  else
    command -v certbot >/dev/null 2>&1 || die "certbot n'est pas installé : sudo apt install -y certbot"
    [ -n "$EMAIL" ] || die "EMAIL est obligatoire pour le certificat (ou SKIP_TLS=1)."
    getent hosts "$DOMAIN" >/dev/null 2>&1 \
      || die "$DOMAIN ne résout pas. Crée d'abord un enregistrement DNS A vers ce serveur (les échecs de certbot comptent dans ses limites)."

    info "demande d'un certificat pour $DOMAIN"
    apply deploy/nginx-bootstrap.conf.tmpl
    # Le --deploy-hook est gardé dans la configuration de renouvellement : nginx recharge
    # le nouveau certificat après chaque renouvellement automatique.
    sudo certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --email "$EMAIL" \
      --agree-tos --non-interactive --deploy-hook "systemctl reload nginx"
    apply deploy/nginx-site.conf.tmpl
    CERT_READY=1
  fi
  info "nginx sert $DOMAIN"
fi

# ---------------------------------------------------------------- 5. certificat

step "5/6  Renouvellement du certificat"
if [ "$CERT_READY" != "1" ]; then
  info "pas de certificat géré ici"
elif systemctl list-timers 2>/dev/null | grep -q certbot; then
  info "certbot.timer renouvelle le certificat automatiquement"
  if sudo certbot renew --dry-run --quiet; then
    info "test de renouvellement réussi"
  else
    warn "le test de renouvellement a échoué : sudo certbot renew --dry-run"
  fi
else
  warn "aucun minuteur certbot trouvé : ajoute « certbot renew » à une tâche cron quotidienne"
fi

# ---------------------------------------------------------------- 6. pare-feu

step "6/6  Pare-feu"
if [ "$FIREWALL" != "1" ]; then
  info "non modifié (FIREWALL=1 pour configurer ufw). À la main :"
  info "  sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable"
elif ! command -v ufw >/dev/null 2>&1; then
  warn "ufw n'est pas installé : étape sautée"
else
  # SSH d'abord : activer ufw sans lui coupe l'accès au serveur.
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw --force enable
  info "ufw n'autorise que SSH et nginx"
fi

# ---------------------------------------------------------------- terminé

printf '\n'
bold "Terminé."
if [ "$SKIP_TLS" = "1" ]; then info "Ouvre http://$DOMAIN/"; else info "Ouvre https://$DOMAIN/"; fi
info "Mise à jour : make upgrade · sauvegarde : make backup"
warn "L'application n'a pas de comptes : toute personne qui connaît l'adresse y a accès."
