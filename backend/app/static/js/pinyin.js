// Saisie et vérification du pinyin.
// Formats acceptés : "ni3 hao3", "ni3hao3", "nǐ hǎo", "lv4" / "lu:4" (= lǜ), ton neutre sans chiffre ou 5/0.

const TONE_MARKS = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ",
};

// Règle de placement : a ou e en priorité, o dans "ou", sinon la dernière voyelle du groupe.
// Les majuscules sont conservées ("Bei3jing1" → "Běijīng").
function markSyllable(letters, tone) {
  if (tone < 1 || tone > 4) return letters;
  const lower = letters.toLowerCase();
  const cluster = [...lower.matchAll(/[aeiouü]+/g)].pop();
  if (!cluster) return letters;
  let offset = cluster[0].search(/[ae]/);
  if (offset < 0) offset = cluster[0].indexOf("ou");
  if (offset < 0) offset = cluster[0].length - 1;
  const pos = cluster.index + offset;
  let mark = TONE_MARKS[lower[pos]][tone - 1];
  if (letters[pos] !== lower[pos]) mark = mark.toUpperCase();
  return letters.slice(0, pos) + mark + letters.slice(pos + 1);
}

/** Convertit les chiffres de ton en accents : "ni3 hao3" → "nǐ hǎo". */
export function numbersToMarks(input) {
  return input
    .replace(/u:|v/g, "ü")
    .replace(/U:|V/g, "Ü")
    .replace(/([a-zA-ZüÜ]+)([0-5])/g, (_, letters, tone) => markSyllable(letters, Number(tone)));
}

const normalize = (s) =>
  numbersToMarks(s).toLowerCase().normalize("NFC").replace(/[\s'’\-·.,!?。，！？]/g, "");

// Retire les accents de ton mais garde le tréma du ü.
const stripTones = (s) =>
  s.normalize("NFD").replace(/[̀́̄̌]/g, "").normalize("NFC");

/**
 * Compare une saisie au pinyin attendu.
 * Renvoie "empty", "correct", "tones" (bonnes syllabes, tons faux) ou "wrong".
 */
export function checkPinyin(input, expected) {
  const given = normalize(input);
  const target = normalize(expected);
  if (!given) return "empty";
  if (given === target) return "correct";
  if (stripTones(given) === stripTones(target)) return "tones";
  return "wrong";
}
