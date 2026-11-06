// Prononciation : audio généré par le serveur (synthèse vocale hors ligne, voir app/tts.py).
// Si le serveur ne peut pas parler, on se rabat sur une voix chinoise du navigateur s'il en a une.

import { escape } from "./api.js";
import { toast } from "./ui.js";

let current = null;
let browserVoice = null;

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  browserVoice =
    voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ??
    voices.find((v) => /^zh/i.test(v.lang) && !/HK|TW/i.test(v.lang)) ??
    voices.find((v) => /^zh/i.test(v.lang)) ??
    null;
}

if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

function speakWithBrowser(text) {
  if (!browserVoice) {
    toast("Prononciation indisponible : le serveur n'a pas pu générer l'audio.", "error");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = browserVoice;
  utterance.lang = browserVoice.lang;
  utterance.rate = 0.8;
  speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  current?.pause();
  current = null;
  window.speechSynthesis?.cancel();
}

/**
 * Prononce un texte en mandarin. `pinyin` fixe la lecture d'un caractère seul
 * (长 cháng ou zhǎng), que la synthèse ne peut pas deviner sans contexte.
 */
export function speak(text, pinyin) {
  stopSpeaking();
  const params = new URLSearchParams({ text });
  if (pinyin) params.set("pinyin", pinyin);
  const audio = new Audio(`/api/tts?${params}`);
  current = audio;
  audio.play().catch((err) => {
    // Interrompu par une autre lecture, ou lecture automatique bloquée par le navigateur.
    if (err.name === "AbortError" || err.name === "NotAllowedError" || current !== audio) return;
    speakWithBrowser(text);
  });
}

/** Bouton 🔊 : `<button data-speak="…">`. Le clic est géré par `bindSpeakButtons`. */
export const speakButton = (text, { pinyin = "", label = "Écouter" } = {}) =>
  `<button type="button" class="icon-button" data-speak="${escape(text)}"
     data-pinyin="${escape(pinyin)}" title="${label}" aria-label="${label}">🔊</button>`;

export function bindSpeakButtons(root) {
  root.addEventListener("click", (e) => {
    const button = e.target.closest("[data-speak]");
    if (!button) return;
    e.stopPropagation();
    speak(button.dataset.speak, button.dataset.pinyin);
  });
}
