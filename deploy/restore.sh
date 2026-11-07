#!/usr/bin/env bash
# Restaure une sauvegarde faite par backup.sh (via `make restore FILE=...`).
# Remplace le contenu de la base : une sauvegarde de l'état actuel est faite avant.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

file="${1:-}"
[ -n "$file" ] || die "indique le fichier : make restore FILE=backups/chinese-....sql.gz"
[ -f "$file" ] || die "fichier introuvable : $file"

warn "La base va être remplacée par $file."
if [ "${YES:-0}" != "1" ]; then
  read -r -p "  Continuer ? [o/N] " answer
  case "$answer" in o|O|oui|y|Y) ;; *) die "annulé" ;; esac
fi

step "Sauvegarde de l'état actuel"
bash deploy/backup.sh

step "Restauration"
$COMPOSE stop app
gunzip -c "$file" | $COMPOSE exec -T db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' >/dev/null
$COMPOSE start app
wait_healthy
info "base restaurée depuis $file"
