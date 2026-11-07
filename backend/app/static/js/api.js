import { isNetworkError, queueReview } from "./offline.js";

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    // Hors ligne, une réponse de test attend dans le navigateur (envoyée au retour du réseau).
    if (path === "/reviews" && options.method === "POST" && isNetworkError(err)) {
      queueReview(options.body);
      return { offline: true };
    }
    throw isNetworkError(err) ? new Error("Hors ligne : connexion au serveur impossible") : err;
  }
  if (!res.ok) {
    // Session expirée ou fermée ailleurs : l'application renvoie vers la connexion.
    if (res.status === 401 && path !== "/account/login") {
      window.dispatchEvent(new Event("session-expired"));
    }
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg).join(", ")
      : body.detail;
    throw new Error(detail || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

export const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Modes de révision (même ordre que le backend).
// `answer` : ce que l'élève fournit en mode test — meaning (sens tapé, vérifié avec souplesse),
// strokes (caractères tracés dans l'ordre des traits), pinyin (tapé avec les tons), choice
// (un classificateur parmi 4). `listen` : le mot présenté peut être écouté sans donner la réponse.
// answer : type de réponse attendue ; audio : ce qui est joué d'office (« word » : le mot,
// « sentence » : la phrase d'exemple) ; listen : bouton d'écoute du mot avant la réponse.
export const MODES = {
  hanzi_to_meaning: { label: "汉字 → sens", answer: "meaning", listen: true },
  pinyin_to_meaning: { label: "Pinyin → 汉字 + sens", answer: "meaning", listen: true },
  audio_to_meaning: { label: "Écoute → sens", answer: "meaning", audio: "word" },
  tones: { label: "Écoute → tons", answer: "tones", audio: "word" },
  audio_to_pinyin: { label: "Écoute → pinyin (dictée)", answer: "pinyin", audio: "word" },
  sentence_cloze: { label: "Phrase à trous", answer: "cloze" },
  sentence_order: { label: "Phrase à remettre dans l'ordre", answer: "order" },
  meaning_to_hanzi: { label: "Sens → 汉字 (tracé)", answer: "strokes", listen: true },
  audio_to_hanzi: { label: "Écoute → 汉字 (dictée tracée)", answer: "strokes", audio: "word" },
  hanzi_to_pinyin: { label: "汉字 → pinyin (saisie)", answer: "pinyin" },
  meaning_to_pinyin: { label: "Sens → pinyin (saisie)", answer: "pinyin" },
  sentence_dictation: { label: "Dictée de phrase", answer: "sentence", audio: "sentence" },
  classifier: { label: "Nom → classificateur", answer: "choice", listen: true },
};

export const ANSWER_HINTS = {
  meaning: "sens tapé en français, vérifié avec souplesse",
  strokes: "caractères tracés dans l'ordre des traits",
  pinyin: "pinyin tapé avec les tons, vérifié",
  choice: "choix parmi 4 · noms seulement",
  tones: "ton de chaque syllabe, à cliquer ou au clavier (1–4, 5 neutre)",
  cloze: "mot manquant de la phrase d'exemple, choix parmi 4",
  order: "mots de la phrase d'exemple à remettre dans l'ordre",
  sentence: "phrase d'exemple entendue, tapée en caractères (clavier 汉)",
};
