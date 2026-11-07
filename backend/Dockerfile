# Modèle de synthèse vocale chinoise (Matcha, voix « baker ») et son vocodeur, téléchargés
# une fois à la construction : l'app fonctionne ensuite hors ligne.
FROM docker.io/library/python:3.13-slim AS tts-model

ARG RELEASES=https://github.com/k2-fsa/sherpa-onnx/releases/download
WORKDIR /opt/tts
RUN python -c "import tarfile, urllib.request as u; \
tarfile.open(fileobj=u.urlopen('$RELEASES/tts-models/matcha-icefall-zh-baker.tar.bz2'), mode='r|bz2').extractall(filter='data'); \
u.urlretrieve('$RELEASES/vocoder-models/vocos-22khz-univ.onnx', 'vocos-22khz-univ.onnx')"

# Dictionnaire CC-CEDICT (CC BY-SA 4.0) pour la saisie des caractères par le pinyin.
ARG CEDICT=https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
WORKDIR /opt/dict
RUN python -c "import gzip, urllib.request as u; \
open('cedict_ts.u8', 'wb').write(gzip.decompress(u.urlopen('$CEDICT').read()))"

# Ordre des traits : Hanzi Writer (MIT) et les tracés de 9 500 caractères (hanzi-writer-data,
# Arphic Public License), servis par l'app au lieu d'un CDN : ils marchent aussi hors ligne.
ARG NPM=https://registry.npmjs.org
WORKDIR /opt/strokes
RUN python -c "import tarfile, urllib.request as u; \
t = tarfile.open(fileobj=u.urlopen('$NPM/hanzi-writer/-/hanzi-writer-3.7.2.tgz'), mode='r|gz'); \
[open('hanzi-writer.min.js', 'wb').write(t.extractfile(m).read()) for m in t if m.name == 'package/dist/hanzi-writer.min.js']; \
t = tarfile.open(fileobj=u.urlopen('$NPM/hanzi-writer-data/-/hanzi-writer-data-2.0.1.tgz'), mode='r|gz'); \
import os; os.makedirs('data', exist_ok=True); \
[open('data/' + m.name.split('/')[-1], 'wb').write(t.extractfile(m).read()) for m in t \
 if m.isfile() and m.name.endswith('.json') and m.name.count('/') == 1 and not m.name.endswith('package.json')]"


FROM docker.io/library/python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=tts-model /opt/tts /opt/tts
COPY --from=tts-model /opt/dict /opt/dict
COPY --from=tts-model /opt/strokes /opt/strokes
COPY app ./app

RUN useradd --system --uid 1001 appuser
USER appuser

EXPOSE 8000
# --proxy-headers : derrière nginx, l'app sait que la requête est en HTTPS (cookies « Secure »).
# Le port n'est publié que sur 127.0.0.1 : seul nginx peut envoyer ces en-têtes.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
