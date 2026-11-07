export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) {
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

// Modes de révision (même ordre que le backend). `typed` : réponse saisie et vérifiée.
export const MODES = {
  hanzi_to_meaning: { label: "汉字 → sens", typed: false },
  pinyin_to_meaning: { label: "Pinyin → 汉字 + sens", typed: false },
  audio_to_meaning: { label: "Écoute → 汉字 + sens", typed: false, audio: true },
  meaning_to_hanzi: { label: "Sens → 汉字", typed: false },
  hanzi_to_pinyin: { label: "汉字 → pinyin (saisie)", typed: true },
  meaning_to_pinyin: { label: "Sens → pinyin (saisie)", typed: true },
  classifier: { label: "Nom → classificateur", typed: false, choice: true },
};
