export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
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
export const MODES = {
  hanzi_to_meaning: { label: "汉字 → sens", answer: "meaning", listen: true },
  pinyin_to_meaning: { label: "Pinyin → 汉字 + sens", answer: "meaning", listen: true },
  audio_to_meaning: { label: "Écoute → 汉字 + sens", answer: "meaning", audio: true },
  meaning_to_hanzi: { label: "Sens → 汉字 (tracé)", answer: "strokes", listen: true },
  hanzi_to_pinyin: { label: "汉字 → pinyin (saisie)", answer: "pinyin" },
  meaning_to_pinyin: { label: "Sens → pinyin (saisie)", answer: "pinyin" },
  classifier: { label: "Nom → classificateur", answer: "choice", listen: true },
};

export const ANSWER_HINTS = {
  meaning: "sens tapé en français, vérifié avec souplesse",
  strokes: "caractères tracés dans l'ordre des traits",
  pinyin: "pinyin tapé avec les tons, vérifié",
  choice: "choix parmi 4 · noms seulement",
};
