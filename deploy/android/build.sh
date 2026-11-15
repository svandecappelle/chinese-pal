#!/usr/bin/env bash
# Construit l'APK dans le conteneur (voir Dockerfile). /work est le dossier android/ du dépôt :
# clé de signature, projet généré, APK. Variables : DOMAIN, PACKAGE_ID, APP_NAME, KEYSTORE_PASSWORD,
# VERSION_CODE, VERSION_NAME, ICON_BASE (facultatif : d'où télécharger icônes et manifeste).
set -euo pipefail

: "${DOMAIN:?}" "${PACKAGE_ID:?}" "${KEYSTORE_PASSWORD:?}" "${VERSION_CODE:?}" "${VERSION_NAME:?}"
APP_NAME="${APP_NAME:-汉语 · Révision}"
ICON_BASE="${ICON_BASE:-https://$DOMAIN}"
KEYSTORE=/work/signing.keystore
ALIAS=android

# Bubblewrap : JDK et SDK déjà installés (sinon il propose de les télécharger).
JDK="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
mkdir -p ~/.bubblewrap
printf '{"jdkPath": "%s", "androidSdkPath": "%s"}\n' "$JDK" "$ANDROID_HOME" > ~/.bubblewrap/config.json

# Clé de signature : créée une fois, à garder. Les mises à jour de l'appli doivent être
# signées avec la même clé, sinon Android refuse de les installer par-dessus.
if [ ! -f "$KEYSTORE" ]; then
  echo "==> Nouvelle clé de signature : android/signing.keystore (à sauvegarder)"
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KEYSTORE_PASSWORD" -keypass "$KEYSTORE_PASSWORD" \
    -dname "CN=$DOMAIN" >/dev/null
fi
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$KEYSTORE_PASSWORD" \
  | sed -n 's/^.*SHA256: *//p' | head -1 > /work/fingerprint.txt

mkdir -p /work/project
cd /work/project
cat > twa-manifest.json <<EOF
{
  "packageId": "$PACKAGE_ID",
  "host": "$DOMAIN",
  "name": "$APP_NAME",
  "launcherName": "汉语",
  "display": "standalone",
  "orientation": "default",
  "themeColor": "#C0392B",
  "themeColorDark": "#1B1A18",
  "navigationColor": "#000000",
  "navigationColorDark": "#000000",
  "navigationDividerColor": "#000000",
  "navigationDividerColorDark": "#000000",
  "backgroundColor": "#FAF7F2",
  "enableNotifications": false,
  "startUrl": "/",
  "iconUrl": "$ICON_BASE/icons/icon-512.png",
  "maskableIconUrl": "$ICON_BASE/icons/icon-maskable-512.png",
  "splashScreenFadeOutDuration": 300,
  "signingKey": { "path": "$KEYSTORE", "alias": "$ALIAS" },
  "appVersion": "$VERSION_NAME",
  "appVersionCode": $VERSION_CODE,
  "shortcuts": [],
  "generatorApp": "bubblewrap-cli",
  "webManifestUrl": "$ICON_BASE/manifest.webmanifest",
  "fallbackType": "webview",
  "features": {},
  "alphaDependencies": { "enabled": false },
  "enableSiteSettingsShortcut": true,
  "isChromeOSOnly": false,
  "isMetaQuest": false,
  "fullScopeUrl": "https://$DOMAIN/",
  "minSdkVersion": 24
}
EOF

echo "==> Projet Android généré depuis twa-manifest.json"
bubblewrap update --skipVersionUpgrade --manifest=./twa-manifest.json

echo "==> Construction et signature de l'APK"
BUBBLEWRAP_KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" BUBBLEWRAP_KEY_PASSWORD="$KEYSTORE_PASSWORD" \
  bubblewrap build --skipPwaValidation --manifest=./twa-manifest.json

cp app-release-signed.apk /work/app-release-signed.apk
# Docker sans mode « rootless » : les fichiers reviennent à l'utilisateur qui a lancé make apk.
if [ -n "${HOST_UID:-}" ]; then chown -R "$HOST_UID:${HOST_GID:-$HOST_UID}" /work; fi
echo "==> APK prêt"
