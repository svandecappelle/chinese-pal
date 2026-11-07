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


FROM docker.io/library/python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=tts-model /opt/tts /opt/tts
COPY --from=tts-model /opt/dict /opt/dict
COPY app ./app

RUN useradd --system --uid 1001 appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
