// Préparer un exercice pour le hors ligne : charger d'avance, avec le réseau, tout ce dont il a
// besoin sans réseau. Le service worker garde ces réponses (voir pwa/sw.js) :
// - la file du test et la liste des mots (API, dernière réponse gardée) ;
// - les tracés de tous ses caractères et l'audio de ses mots, classificateurs et phrases
//   d'exemple (gardés pour de bon).
// Les adresses sont celles qu'utilisent les écrans (ttsUrl, strokesUrl) : le cache les retrouve.

import { ttsUrl } from "./audio.js";
import { strokesUrl } from "./strokes.js";

const READY_KEY = "chinese.offlineReady";
const HANZI = /[一-鿿]/g;
const PARALLEL = 4;

/** Le hors ligne est-il possible ici (service worker actif) ? */
export const offlineSupported = () => Boolean(navigator.serviceWorker?.controller);

/** Exercices déjà préparés : {id: {at, files}}. */
export function preparedExercises() {
  try {
    return JSON.parse(localStorage.getItem(READY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function markPrepared(id, files) {
  const ready = preparedExercises();
  ready[id] = { at: new Date().toISOString(), files };
  try {
    localStorage.setItem(READY_KEY, JSON.stringify(ready));
  } catch {
    // Stockage indisponible : l'exercice est préparé, mais ne sera pas signalé comme tel.
  }
}

/** Oublie les exercices préparés (changement de compte : le cache de l'API est vidé). */
export function forgetPrepared() {
  try {
    localStorage.removeItem(READY_KEY);
  } catch {
    // Rien à faire.
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.json();
}

/**
 * Prépare l'exercice. `onProgress(done, total)` suit le chargement des tracés et de l'audio.
 * Renvoie {files, missing} (missing : tracés ou audio indisponibles, sans gravité).
 */
export async function prepareExercise(id, onProgress = () => {}) {
  // L'API d'abord : file du test, mots à réviser, liste des exercices (écran d'accueil).
  const [session, study] = await Promise.all([
    getJson(`/api/exercises/${id}/session`),
    getJson(`/api/exercises/${id}/words`),
    getJson("/api/exercises"),
  ]);
  const urls = new Set();
  const chars = new Set();
  const addAudio = (text, pinyin) => text && urls.add(ttsUrl(text, pinyin));
  for (const w of [...study.words, ...session.cards]) {
    addAudio(w.hanzi, w.pinyin);
    addAudio(w.measure?.hanzi);
    addAudio(w.example?.hanzi);
    for (const c of w.hanzi.match(HANZI) ?? []) chars.add(c);
  }
  for (const c of chars) urls.add(strokesUrl(c));

  const queue = [...urls];
  const total = queue.length;
  let done = 0;
  let missing = 0;
  onProgress(0, total);
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url);
        // L'audio n'est gardé qu'une fois lu jusqu'au bout.
        if (res.ok) await res.arrayBuffer();
        else missing += 1;
      } catch {
        missing += 1;
      }
      done += 1;
      onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (missing === total && total > 0) throw new Error("Hors ligne : rien n'a pu être chargé");
  markPrepared(id, total);
  return { files: total, missing };
}
