#!/usr/bin/env bash
# Sauvegarde de la base : backups/chinese-AAAAMMJJ-HHMMSS.sql.gz (via `make backup`).
# Les sauvegardes de plus de BACKUP_DAYS jours (30 par défaut) sont supprimées.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP_DAYS="${BACKUP_DAYS:-30}"
mkdir -p backups
file="backups/chinese-$(date +%Y%m%d-%H%M%S).sql.gz"

# --clean : la sauvegarde remplace les tables à la restauration au lieu d'échouer sur l'existant.
if ! $COMPOSE exec -T db sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | gzip > "$file.tmp"; then
  rm -f "$file.tmp"
  die "la sauvegarde a échoué (la base tourne-t-elle ? $COMPOSE ps)"
fi
mv "$file.tmp" "$file"
info "sauvegarde : $file ($(du -h "$file" | cut -f1))"

find backups -name 'chinese-*.sql.gz' -mtime "+$BACKUP_DAYS" -print -delete | sed 's/^/  supprimée (ancienne) : /'
