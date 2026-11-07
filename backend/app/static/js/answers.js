// Vérification souple d'un sens tapé en français : une traduction contient souvent plusieurs
// sens (« verre, tasse »), des précisions entre parenthèses, des articles…

// Mots qui ne changent pas le sens : articles, « se », « to » d'un verbe anglais…
const FILLERS = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "se", "s", "to", "the"]);

/** Minuscules, sans accents, sans ponctuation ni articles. */
export function normalizeMeaning(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w))
    .join(" ");
}

/** Sens acceptés : chaque partie de la traduction, avec et sans ses parenthèses. */
export function acceptedMeanings(translation) {
  const parts = new Set();
  const withoutParens = translation.replace(/\([^)]*\)/g, " ");
  for (const source of [translation, withoutParens]) {
    for (const part of source.split(/[;,/、]|\bou\b/)) {
      const normalized = normalizeMeaning(part);
      if (normalized) parts.add(normalized);
    }
  }
  return [...parts];
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * Compare la réponse à la traduction.
 * Renvoie "correct", "close" (faute de frappe probable), "wrong" ou "empty".
 */
export function checkMeaning(answer, translation) {
  const given = normalizeMeaning(answer);
  if (!given) return "empty";
  const accepted = acceptedMeanings(translation);
  const words = (s) => s.split(" ");
  for (const meaning of accepted) {
    if (given === meaning) return "correct";
    // « manger » pour « manger, prendre un repas » ; « pomme » pour « pomme (fruit) »…
    const givenWords = words(given);
    const meaningWords = words(meaning);
    if (givenWords.every((w) => meaningWords.includes(w)) && given.length >= Math.min(4, meaning.length)) {
      return "correct";
    }
  }
  for (const meaning of accepted) {
    const tolerance = meaning.length >= 9 ? 2 : meaning.length >= 4 ? 1 : 0;
    if (tolerance && distance(given, meaning) <= tolerance) return "close";
  }
  return "wrong";
}
