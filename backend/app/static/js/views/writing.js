import { api, escape } from "../api.js";
import { attachKeyboard, close as closeKeyboard } from "../keyboard.js";
import { numbersToMarks } from "../pinyin.js";

// Fiches d'entraînement à l'écriture, à imprimer : pour chaque caractère, l'ordre des traits
// pas à pas, un modèle, des modèles grisés à repasser, puis des cases vides (田字格 ou 米字格).

const HANZI = /[㐀-鿿]/;
const SETTINGS_KEY = "chinese.sheets";
const DEFAULTS = {
  source: "text", text: "", grid: "tian", size: 16, traces: 3, rows: 1,
  pinyin: true, meaning: true, strokes: true, unique: true,
};
const SIZES = { 12: "Petites (12 mm)", 16: "Moyennes (16 mm)", 20: "Grandes (20 mm)" };
const GRIDS = { tian: "田字格 (croix)", mi: "米字格 (croix et diagonales)", plain: "Cases vides" };
// Largeur utile d'une page A4 avec les marges d'impression (voir @page dans style.css).
const PAGE_WIDTH_MM = 186;
// Au-delà, la fiche devient longue à préparer et à imprimer : on n'en coche que ce nombre.
const DEFAULT_PICK = 30;

function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : réglages non mémorisés.
  }
}

// Tracés des traits (données Hanzi Writer), gardés pour ne pas les recharger à chaque réglage.
// null : caractère inconnu ou pas de connexion, on l'écrit alors avec la police.
const charData = new Map();
// Pinyin (d'après le dictionnaire) des mots tapés qui ne sont pas dans le vocabulaire.
const readings = new Map();

async function loadReadings(words) {
  const missing = [...new Set(words.filter((w) => !w.pinyin && !readings.has(w.hanzi)).map((w) => w.hanzi))];
  if (!missing.length) return;
  try {
    const found = await api(`/ime/lectures?q=${encodeURIComponent(missing.join(" "))}`);
    missing.forEach((hanzi) => readings.set(hanzi, found[hanzi] ? numbersToMarks(found[hanzi]) : ""));
  } catch {
    // Dictionnaire indisponible : les mots tapés restent sans pinyin.
  }
}

function loadChar(char) {
  if (!charData.has(char)) {
    charData.set(char, window.HanziWriter
      ? HanziWriter.loadCharacterData(char, { onLoadCharDataError: () => {} }).catch(() => null)
      : Promise.resolve(null));
  }
  return charData.get(char);
}

async function loadAll(chars) {
  const queue = [...chars];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) await loadChar(queue.shift());
  }));
}

// --- Dessin (SVG en 1024 × 1024, repère des données Hanzi Writer) ---

function guides(grid) {
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  let lines = "";
  if (grid !== "plain") lines += line(512, 0, 512, 1024) + line(0, 512, 1024, 512);
  if (grid === "mi") lines += line(0, 0, 1024, 1024) + line(1024, 0, 0, 1024);
  return lines ? `<g class="guide">${lines}</g>` : "";
}

// `upto` premiers traits ; `current` : indice du trait mis en évidence (ordre des traits).
function glyph(char, data, cls, upto = Infinity, current = -1) {
  if (!data) {
    return `<text x="512" y="560" class="${cls}" text-anchor="middle" dominant-baseline="middle"
      font-size="800">${escape(char)}</text>`;
  }
  const paths = data.strokes.slice(0, upto)
    .map((d, i) => `<path d="${d}"${i === current ? ' class="current"' : ""}/>`).join("");
  return `<g class="${cls}" transform="translate(72 72) scale(.86) translate(0 900) scale(1 -1)">${paths}</g>`;
}

const cell = (grid, content = "") =>
  `<svg class="cell" viewBox="0 0 1024 1024" aria-hidden="true">${guides(grid)}${content}</svg>`;

// `head` (en-tête du mot) est placé dans le bloc du premier caractère pour ne jamais rester seul
// en bas d'une page imprimée.
function charBlock(char, data, s, perRow, head = "") {
  const strip = s.strokes && data ? `
    <div class="stroke-strip" title="Ordre des traits">
      ${data.strokes.map((_, i) => cell("plain", glyph(char, data, "ink", i + 1, i))).join("")}
      <span class="stroke-count">${data.strokes.length} trait${data.strokes.length > 1 ? "s" : ""}</span>
    </div>` : "";
  const traces = Math.min(s.traces, perRow - 1);
  const first = [
    cell(s.grid, glyph(char, data, "ink")),
    ...Array.from({ length: traces }, () => cell(s.grid, glyph(char, data, "trace"))),
    ...Array.from({ length: perRow - 1 - traces }, () => cell(s.grid)),
  ];
  const empty = Array.from({ length: perRow }, () => cell(s.grid)).join("");
  return `<div class="sheet-char">
    ${head}
    ${strip}
    <div class="practice-row">${first.join("")}</div>
    ${Array.from({ length: s.rows - 1 }, () => `<div class="practice-row">${empty}</div>`).join("")}
  </div>`;
}

// Découpe un texte libre en mots (séparés par des espaces ou de la ponctuation).
function wordsFromText(text, known) {
  return text.split(/[\s,，、;；.。!！?？]+/)
    .map((token) => [...token].filter((c) => HANZI.test(c)).join(""))
    .filter(Boolean)
    .map((hanzi) => known.get(hanzi) ?? { hanzi, pinyin: "", translation: "" });
}

export async function writingView(el, { id, deck }) {
  const [allWords, decks, exercises] = await Promise.all([
    api("/words"), api("/decks"), api("/exercises").catch(() => []),
  ]);
  const known = new Map();
  allWords.forEach((w) => known.has(w.hanzi) || known.set(w.hanzi, w));
  const settings = readSettings();
  if (id) settings.source = `ex:${id}`;
  else if (deck) settings.source = `deck:${deck}`;
  const sources = new Set(["text", ...exercises.map((x) => `ex:${x.id}`),
    ...decks.filter((d) => d.word_count).map((d) => `deck:${d.id}`)]);
  if (!sources.has(settings.source)) settings.source = "text";

  let words = [];      // mots de la source choisie
  let picked = new Set();
  let title = "";
  let renderId = 0;

  el.innerHTML = `
    <div class="toolbar no-print">
      <div>
        <h2>Fiches d'écriture</h2>
        <p class="muted small">Ordre des traits, modèles à repasser et cases pour s'entraîner, à imprimer.</p>
      </div>
      <button type="button" id="print">🖨 Imprimer</button>
    </div>
    <div class="panel sheet-options no-print">
      <div class="row">
        <label>Mots
          <select id="source">
            <option value="text">Caractères au choix</option>
            ${exercises.length ? `<optgroup label="Exercices">
              ${exercises.map((x) => `<option value="ex:${x.id}">${escape(x.name)}</option>`).join("")}
            </optgroup>` : ""}
            <optgroup label="Listes de vocabulaire">
              ${decks.filter((d) => d.word_count).map((d) =>
                `<option value="deck:${d.id}">${escape(d.name)} (${d.word_count})</option>`).join("")}
            </optgroup>
          </select>
        </label>
        <label>Quadrillage
          <select id="grid">${Object.entries(GRIDS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        </label>
        <label>Taille des cases
          <select id="size">${Object.entries(SIZES).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        </label>
      </div>
      <label id="text-field"><span id="text-label"></span>
        <textarea id="text" rows="2" lang="zh" placeholder="你好 谢谢 学习 中国"></textarea>
      </label>
      <div id="pick-field" hidden>
        <div class="row pick-head">
          <span class="muted small" id="pick-count"></span>
          <button type="button" class="link" id="pick-all">Tout cocher</button>
          <button type="button" class="link" id="pick-none">Tout décocher</button>
        </div>
        <div class="chips pick-list" id="pick-list"></div>
      </div>
      <div class="row">
        <label>Modèles grisés à repasser
          <select id="traces">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join("")}</select>
        </label>
        <label>Lignes par caractère
          <select id="rows">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select>
        </label>
      </div>
      <div class="row checks">
        <label class="check"><input type="checkbox" id="strokes"> Ordre des traits</label>
        <label class="check"><input type="checkbox" id="pinyin"> Pinyin</label>
        <label class="check"><input type="checkbox" id="meaning"> Sens</label>
        <label class="check" title="Un caractère déjà présent plus haut sur la fiche n'est pas répété">
          <input type="checkbox" id="unique"> Sans répétition</label>
      </div>
    </div>
    <p class="muted small no-print" id="sheet-status" aria-live="polite"></p>
    <div class="sheet-scroll"><div class="sheet" id="sheet"></div></div>`;

  const $ = (sel) => el.querySelector(sel);
  for (const key of ["source", "grid", "size", "traces", "rows"]) $(`#${key}`).value = String(settings[key]);
  for (const key of ["strokes", "pinyin", "meaning", "unique"]) $(`#${key}`).checked = settings[key];
  $("#text").value = settings.text;
  // Clavier chinois (汉) : on tape le pinyin et on choisit les caractères.
  attachKeyboard($("#text"), "hanzi");

  async function loadSource() {
    const source = settings.source;
    $("#text-label").textContent = source === "text"
      ? "Caractères ou mots, séparés par des espaces"
      : "Caractères en plus, ajoutés après les mots cochés (facultatif)";
    $("#pick-field").hidden = source === "text";
    if (source === "text") {
      title = "";
      words = [];
      return render();
    }
    const [kind, value] = source.split(":");
    if (kind === "ex") {
      const data = await api(`/exercises/${value}/words`);
      title = data.exercise.name;
      words = data.words;
    } else {
      title = decks.find((d) => String(d.id) === value)?.name ?? "";
      words = allWords.filter((w) => w.deck_ids.includes(Number(value)));
    }
    picked = new Set(words.slice(0, DEFAULT_PICK).map((_, i) => i));
    renderPicker();
    render();
  }

  function renderPicker() {
    $("#pick-list").innerHTML = words.map((w, i) => `
      <label class="chip" title="${escape(`${w.pinyin} · ${w.translation}`)}">
        <input type="checkbox" data-pick="${i}" ${picked.has(i) ? "checked" : ""}>
        <span lang="zh">${escape(w.hanzi)}</span>
      </label>`).join("");
    updateCount();
  }

  function updateCount() {
    $("#pick-count").textContent = `${picked.size} mot(s) sur ${words.length}`
      + (words.length > DEFAULT_PICK && picked.size === DEFAULT_PICK ? ` (les ${DEFAULT_PICK} premiers)` : "");
  }

  function selectedWords() {
    const typed = wordsFromText(settings.text, known)
      .map((w) => (w.pinyin ? w : { ...w, pinyin: readings.get(w.hanzi) ?? "" }));
    return settings.source === "text" ? typed : [...words.filter((_, i) => picked.has(i)), ...typed];
  }

  async function render() {
    const id = ++renderId;
    await loadReadings(wordsFromText(settings.text, known));
    if (id !== renderId) return;
    const list = selectedWords();
    const chars = [...new Set(list.flatMap((w) => [...w.hanzi].filter((c) => HANZI.test(c))))];
    const sheet = $("#sheet");
    if (!chars.length) {
      sheet.innerHTML = `<p class="sheet-empty">${settings.source === "text"
        ? "Tape des caractères ci-dessus pour préparer la fiche."
        : "Coche au moins un mot ou tape des caractères."}</p>`;
      $("#sheet-status").textContent = "";
      return;
    }
    $("#sheet-status").textContent = `Préparation de ${chars.length} caractère(s)…`;
    await loadAll(chars);
    if (id !== renderId) return;  // un réglage a changé entre-temps
    const data = new Map(await Promise.all(chars.map(async (c) => [c, await loadChar(c)])));

    const perRow = Math.floor(PAGE_WIDTH_MM / settings.size);
    const seen = new Set();
    const blocks = list.map((w) => {
      const own = [...w.hanzi].filter((c) => HANZI.test(c) && !(settings.unique && seen.has(c)));
      if (!own.length) return "";
      own.forEach((c) => seen.add(c));
      const head = `<div class="sheet-word-head">
          <span class="sheet-hanzi" lang="zh">${escape(w.hanzi)}</span>
          ${settings.pinyin && w.pinyin ? `<span class="sheet-pinyin">${escape(w.pinyin)}</span>` : ""}
          ${settings.meaning && w.translation ? `<span class="sheet-meaning">${escape(w.translation)}</span>` : ""}
        </div>`;
      return `<section class="sheet-word">
        ${[...new Set(own)].map((c, i) => charBlock(c, data.get(c), settings, perRow, i ? "" : head)).join("")}
      </section>`;
    }).join("");

    sheet.style.setProperty("--cell", `${settings.size}mm`);
    sheet.innerHTML = `
      <div class="sheet-head">
        <strong>${escape(title || "Fiche d'écriture")}</strong>
        <span>Nom : <span class="blank"></span></span>
        <span>Date : <span class="blank short"></span></span>
      </div>
      ${blocks}`;
    const missing = chars.filter((c) => !data.get(c));
    $("#sheet-status").textContent = missing.length
      ? `Ordre des traits indisponible pour ${missing.join(" ")}${window.HanziWriter ? "" : " (pas de connexion ?)"} :
         ${missing.length > 1 ? "ils sont écrits" : "il est écrit"} avec la police, sans les étapes.`
      : `${chars.length} caractère(s) · ${perRow} cases par ligne · format A4`;
  }

  function changed(key, value) {
    settings[key] = value;
    writeSettings(settings);
  }

  $("#source").addEventListener("change", (e) => {
    changed("source", e.target.value);
    loadSource().catch((err) => { $("#sheet-status").textContent = err.message; });
  });
  for (const key of ["grid", "size", "traces", "rows"]) {
    $(`#${key}`).addEventListener("change", (e) => {
      changed(key, key === "grid" ? e.target.value : Number(e.target.value));
      render();
    });
  }
  for (const key of ["strokes", "pinyin", "meaning", "unique"]) {
    $(`#${key}`).addEventListener("change", (e) => {
      changed(key, e.target.checked);
      render();
    });
  }
  let typing = null;
  $("#text").addEventListener("input", (e) => {
    changed("text", e.target.value);
    clearTimeout(typing);
    typing = setTimeout(render, 400);
  });
  $("#pick-list").addEventListener("change", (e) => {
    const i = Number(e.target.dataset.pick);
    if (e.target.checked) picked.add(i);
    else picked.delete(i);
    updateCount();
    render();
  });
  $("#pick-all").addEventListener("click", () => {
    picked = new Set(words.map((_, i) => i));
    renderPicker();
    render();
  });
  $("#pick-none").addEventListener("click", () => {
    picked = new Set();
    renderPicker();
    render();
  });
  $("#print").addEventListener("click", () => window.print());

  await loadSource();
  return () => {
    renderId += 1;
    clearTimeout(typing);
    closeKeyboard();
  };
}
