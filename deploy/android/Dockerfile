# Outils de construction de l'application Android (Trusted Web Activity) : Node + Bubblewrap,
# JDK 17 et SDK Android. Utilisé par `make apk` (deploy/apk.sh) : rien n'est installé sur la machine.
FROM docker.io/library/node:20-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip \
 && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
ARG CMDLINE_TOOLS=https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
 && curl -fsSL "$CMDLINE_TOOLS" -o /tmp/tools.zip \
 && unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools" \
 && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
 && ln -s cmdline-tools/latest "$ANDROID_HOME/tools" \
 && rm /tmp/tools.zip
# Licences acceptées et outils préinstallés : Bubblewrap ne pose aucune question à la construction.
RUN yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null \
 && "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install \
      "platform-tools" "platforms;android-35" "build-tools;34.0.0" "build-tools;35.0.0" >/dev/null

RUN npm install -g @bubblewrap/cli@1.27.0

COPY build.sh /usr/local/bin/build-apk
RUN chmod +x /usr/local/bin/build-apk
WORKDIR /work
CMD ["build-apk"]
