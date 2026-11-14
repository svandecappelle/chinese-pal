#!/usr/bin/env bash
# Application Android (Trusted Web Activity) : construit l'APK et le met en téléchargement sur
# le site (via `make apk`, sur le serveur, une fois le site en ligne en HTTPS).
#
# - L'APK ouvre https://DOMAIN en plein écran avec le Chrome du téléphone : chaque mise à jour du
#   site arrive dans l'appli sans nouvel APK. Le reconstruire seulement si le nom, l'icône ou le
#   domaine changent.
# - downloads/android/chinese-pal.apk et info.json sont servis en /android/ ; downloads/assetlinks.json
#   en /.well-known/assetlinks.json (sans lui, l'appli affiche une barre d'adresse).
# - android/signing.keystore : la clé de signature, à sauvegarder (mot de passe dans .env).
#
# Variables (ou .env) : DOMAIN (obligatoire), ANDROID_PACKAGE (défaut : domaine inversé),
# ICON_BASE et APK_NETWORK (essai sans le site en ligne : icônes prises sur l'app locale, par
# exemple ICON_BASE=http://app:8000 APK_NETWORK=chinese_default).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN="${DOMAIN:-$(env_value DOMAIN "")}"
[ -n "$DOMAIN" ] || die "DOMAIN est obligatoire : make apk DOMAIN=chinois.example.com (ou DOMAIN dans .env)"

# Identifiant Android : le domaine à l'envers (chinois.example.com → com.example.chinois.app).
default_package() {
  local parts=() part
  IFS=. read -ra parts <<< "$1"
  local out=""
  for ((i = ${#parts[@]} - 1; i >= 0; i--)); do
    part="$(printf '%s' "${parts[i]}" | tr 'A-Z-' 'a-z_' | tr -cd 'a-z0-9_')"
    [[ "$part" =~ ^[0-9] ]] && part="x$part"
    [ -n "$part" ] && out="${out:+$out.}$part"
  done
  printf '%s.app' "$out"
}
PACKAGE_ID="${ANDROID_PACKAGE:-$(env_value ANDROID_PACKAGE "$(default_package "$DOMAIN")")}"

# Mot de passe de la clé de signature : généré une fois et gardé dans .env.
touch .env
if ! grep -qE '^ANDROID_KEYSTORE_PASSWORD=' .env; then
  printf '\n# Clé de signature de l application Android (android/signing.keystore), générée par make apk.\nANDROID_KEYSTORE_PASSWORD=%s\n' \
    "$(openssl rand -hex 16)" >> .env
  info "ANDROID_KEYSTORE_PASSWORD ajouté à .env"
fi
KEYSTORE_PASSWORD="$(env_value ANDROID_KEYSTORE_PASSWORD "")"

# Version : toujours croissante (minutes depuis 2020), lisible (date).
VERSION_CODE=$(( ($(date +%s) - 1577836800) / 60 ))
VERSION_NAME="$(date +%Y.%m.%d)"

step "1/3  Outils de construction (image localhost/chinese-apk, longue la première fois)"
$RUNTIME build -t localhost/chinese-apk deploy/android

step "2/3  Construction de l'APK pour https://$DOMAIN ($PACKAGE_ID)"
mkdir -p android downloads/android
# Sous Windows (Git Bash), le moteur de conteneurs attend un chemin « F:/... ».
WORK="$ROOT/android"
command -v cygpath >/dev/null 2>&1 && WORK="$(cygpath -m "$WORK")"
# Le cache de Gradle est gardé entre deux constructions (volume chinese-apk-gradle).
MSYS_NO_PATHCONV=1 $RUNTIME run --rm \
  -v "$WORK:/work" \
  -v chinese-apk-gradle:/root/.gradle \
  -e DOMAIN="$DOMAIN" -e PACKAGE_ID="$PACKAGE_ID" -e KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  -e VERSION_CODE="$VERSION_CODE" -e VERSION_NAME="$VERSION_NAME" \
  -e ICON_BASE="${ICON_BASE:-}" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  ${APK_NETWORK:+--network "$APK_NETWORK"} \
  localhost/chinese-apk

step "3/3  Mise en téléchargement"
FINGERPRINT="$(cat android/fingerprint.txt)"
[ -n "$FINGERPRINT" ] || die "empreinte de la clé introuvable (android/fingerprint.txt)"
cp android/app-release-signed.apk downloads/android/chinese-pal.apk
SIZE="$(wc -c < downloads/android/chinese-pal.apk | tr -d ' ')"
cat > downloads/android/info.json <<EOF
{"file": "chinese-pal.apk", "version": "$VERSION_NAME", "version_code": $VERSION_CODE, "size": $SIZE, "package": "$PACKAGE_ID"}
EOF
cat > downloads/assetlinks.json <<EOF
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {"namespace": "android_app", "package_name": "$PACKAGE_ID",
             "sha256_cert_fingerprints": ["$FINGERPRINT"]}
}]
EOF
chmod 644 downloads/android/* downloads/assetlinks.json
info "APK : downloads/android/chinese-pal.apk ($(( SIZE / 1024 )) Ko, version $VERSION_NAME)"
info "en ligne : https://$DOMAIN/android/chinese-pal.apk"
info "lien appli ↔ site : https://$DOMAIN/.well-known/assetlinks.json"
warn "sauvegarde android/signing.keystore et ANDROID_KEYSTORE_PASSWORD (.env) : sans eux,"
warn "les prochaines versions de l'appli ne pourront pas s'installer par-dessus celle-ci."
