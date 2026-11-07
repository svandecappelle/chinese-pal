#!/usr/bin/env bash
#
# Mise à jour en une commande (via `make upgrade`) : sauvegarde de la base, récupération du
# code, reconstruction, redémarrage. Les migrations de la base s'appliquent au démarrage de
# l'application ; la sauvegarde faite juste avant permet de revenir en arrière.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

before="$(git rev-parse --short HEAD)"

step "1/4  Sauvegarde de la base"
if $COMPOSE ps --status running --services 2>/dev/null | grep -qx db; then
  bash deploy/backup.sh
else
  warn "la base ne tourne pas : pas de sauvegarde"
fi

step "2/4  Récupération du code"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || die "des fichiers suivis ont été modifiés sur ce serveur (git status). Mets-les de côté avant de mettre à jour."
git pull --ff-only
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  info "déjà à jour ($after) : reconstruction quand même"
else
  git log --oneline "$before..$after" | sed 's/^/  /'
fi

step "3/4  Reconstruction et redémarrage"
$COMPOSE up -d --build
wait_healthy
# Passage à une version avec comptes : l'application crée l'administrateur et écrit son
# mot de passe dans le journal (ou prend ADMIN_PASSWORD de .env).
created="$($COMPOSE logs --since 10m app 2>/dev/null | grep -A3 "Compte administrateur créé" | sed 's/^[^|]*| *//' || true)"
if [ -n "$created" ]; then
  warn "premier compte administrateur créé (à noter, il ne sera plus affiché) :"
  printf '%s
' "$created" | sed 's/^/      /' >&2
fi
# Les anciennes images restent sinon sur le disque à chaque mise à jour.
$RUNTIME image prune -f >/dev/null 2>&1 || true

step "4/4  Configuration nginx"
DOMAIN="$(env_value DOMAIN "")"
SITE=/etc/nginx/sites-available/chinese
if [ -z "$DOMAIN" ] || [ ! -f "$SITE" ]; then
  info "pas de site nginx installé par make install"
else
  template=deploy/nginx-site.conf.tmpl
  grep -q 'listen 443' "$SITE" || template=deploy/nginx-plain.conf.tmpl
  expected="$(sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$APP_PORT|g" -e "s|__WEBROOT__|/var/www/html|g" "$template")"
  if [ "$expected" = "$(cat "$SITE")" ]; then
    info "à jour"
  else
    warn "la configuration nginx a changé dans cette version : relance « make install » pour l'appliquer"
  fi
fi

printf '\n'
bold "Mise à jour terminée : $before → $after"
