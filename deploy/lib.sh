# shellcheck shell=bash
# Fonctions communes aux scripts de deploy/ (sourcé, pas exécuté).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die() { printf '\033[31merreur : %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 est nécessaire mais n'est pas installé."; }

# Docker ou Podman : celui qui est installé.
if docker compose version >/dev/null 2>&1; then
  RUNTIME="docker"
  COMPOSE="docker compose"
elif podman compose version >/dev/null 2>&1; then
  RUNTIME="podman"
  COMPOSE="podman compose"
else
  die "Docker (avec « docker compose ») ou Podman (avec « podman compose ») est nécessaire."
fi

# Valeur d'une clé de .env, ou la valeur par défaut.
env_value() {
  local value
  value="$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s' "${value:-$2}"
}

APP_PORT="$(env_value APP_PORT 8000)"

wait_healthy() {
  printf '  attente de l application'
  for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
      printf '\n'
      return 0
    fi
    printf '.'
    sleep 2
  done
  printf '\n'
  die "l'application ne répond pas sur 127.0.0.1:$APP_PORT. Voir : $COMPOSE logs app"
}
