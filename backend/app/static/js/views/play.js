import { ANSWER_HINTS, api, escape, MODES } from "../api.js";
import { checkMeaning } from "../answers.js";
import { bindSpeakButtons, speak, speakButton, stopSpeaking } from "../audio.js";
import { attachKeyboard } from "../keyboard.js";
import { checkPinyin, numbersToMarks } from "../pinyin.js";
import { session } from "../session.js";
import { mountStrokes } from "../strokes.js";
import { toast } from "../ui.js";

// Mode test : chaque carte attend une réponse (sens tapé, pinyin, caractères tracés,
// classificateur, tons, phrase à trous, mots à remettre dans l'ordre, dictée de phrase),
// vérifiée puis notée pour la répétition espacée.

const GRADES = [
  { grade: 1, label: "À revoir", key: "1", cls: "again" },
  { grade: 2, label: "Difficile", key: "2", cls: "hard" },
  { grade: 3, label: "Bien", key: "3", cls: "good" },
  { grade: 4, label: "Facile", key: "4", cls: "easy" },
];

// Une carte ratée revient après quelques autres cartes de la session.
const REQUEUE_OFFSET = 3;
const AUTOPLAY_KEY = "chinese.autoplay";

const bigHanzi = (c) => `<div class="big-hanzi">${escape(c.hanzi)}</div>`;
const bigMeaning = (c) => `<div class="big-meaning">${escape(c.translation)}</div>`;
const listenButton = (c) => speakButton(c.hanzi, { pinyin: c.pinyin, label: "Écouter le mot (A)" });
const bigAudio = (text, pinyin = "") => `
  <button type="button" class="big-audio" data-speak="${escape(text)}"
    ${pinyin ? `data-pinyin="${escape(pinyin)}"` : ""} aria-label="Réécouter">🔊</button>
  <small class="muted">Touche <kbd>A</kbd> pour réécouter</small>`;
const hanziCount = (c) => [...c.hanzi].filter((ch) => /[一-鿿]/.test(ch)).length;
// Syllabe avec son ton (0 = neutre) : « hao », 3 → « hǎo ».
const withTone = (base, tone) => numbersToMarks(`${base}${tone || 5}`);
const toneName = (tone) => ({ 1: "1er ton", 2: "2e ton", 3: "3e ton", 4: "4e ton" })[tone] ?? "neutre";
const TONE_BUTTONS = [
  { tone: 1, label: "ˉ 1er", key: "1" },
  { tone: 2, label: "ˊ 2e", key: "2" },
  { tone: 3, label: "ˇ 3e", key: "3" },
  { tone: 4, label: "ˋ 4e", key: "4" },
  { tone: 0, label: "· neutre", key: "5" },
];
// Seuls les caractères comptent dans une dictée : ponctuation et espaces facultatifs.
const sentenceChars = (text) => [...text].filter((ch) => /[一-鿿0-9A-Za-z]/.test(ch));

/** Plus longue sous-suite commune : indices des caractères attendus retrouvés dans la réponse. */
function matchedIndices(expected, given) {
  const table = Array.from({ length: expected.length + 1 }, () => new Array(given.length + 1).fill(0));
  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = given.length - 1; j >= 0; j -= 1) {
      table[i][j] = expected[i] === given[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const found = new Set();
  for (let i = 0, j = 0; i < expected.length && j < given.length;) {
    if (expected[i] === given[j]) {
      found.add(i);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return found;
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clozePrompt(c) {
  return `<div class="cloze-sentence" lang="zh">${escape(c.cloze.before)}<span class="blank">＿＿</span>${escape(c.cloze.after)}</div>
    <div class="muted">${escape(c.example.translation)}</div>`;
}

// Question et élément présenté pour chaque mode.
const PROMPTS = {
  hanzi_to_meaning: ["Que signifie ce mot ?", (c) => `${bigHanzi(c)}${listenButton(c)}`],
  pinyin_to_meaning: ["Que signifie ce mot ?", (c) => `
    <div class="big-pinyin">${escape(c.pinyin)}</div>${listenButton(c)}`],
  audio_to_meaning: ["Qu'entends-tu ? Donne le sens", (c) => bigAudio(c.hanzi, c.pinyin)],
  tones: ["Quels tons entends-tu ?", (c) => `${bigAudio(c.hanzi, c.pinyin)}
    ${c.syllables ? "" : '<p class="muted small">Tape le pinyin avec les tons.</p>'}`],
  audio_to_pinyin: ["Dictée : tape le pinyin de ce que tu entends", (c) => bigAudio(c.hanzi, c.pinyin)],
  sentence_cloze: ["Quel mot manque dans la phrase ?", (c) => clozePrompt(c)],
  sentence_order: ["Remets les mots dans l'ordre", (c) => (c.tiles
    ? `<div class="big-meaning sentence-meaning">${escape(c.example.translation)}</div>`
    : clozePrompt(c))],
  meaning_to_hanzi: ["Écris-le en chinois, trait par trait", (c) => `${bigMeaning(c)}
    <div class="muted small">${hanziCount(c)} caractère(s) · ${listenButton(c)}</div>`],
  audio_to_hanzi: ["Dictée : écris ce que tu entends, trait par trait", (c) => `
    ${bigAudio(c.hanzi, c.pinyin)}<div class="muted small">${hanziCount(c)} caractère(s)</div>`],
  sentence_dictation: ["Dictée : écris la phrase que tu entends", (c) => bigAudio(c.example.hanzi)],
  hanzi_to_pinyin: ["Tape le pinyin avec les tons", (c) => bigHanzi(c)],
  meaning_to_pinyin: ["Tape le pinyin avec les tons", (c) => bigMeaning(c)],
  classifier: ["Quel classificateur ?", (c) => `
    <div class="big-hanzi">一<span class="blank">？</span>${escape(c.hanzi)}</div>
    <div class="muted">${escape(c.pinyin)} · ${escape(c.translation)} ${listenButton(c)}</div>`],
};

const PINYIN_VERDICTS = {
  correct: ["ok", "✓ Correct", 3],
  tones: ["partial", "≈ Bonnes syllabes, tons incorrects", 1],
  wrong: ["ko", "✗ Incorrect", 1],
  empty: ["ko", "✗ Pas de réponse", 1],
};

const MEANING_VERDICTS = {
  correct: ["ok", "✓ Correct", 3],
  close: ["partial", "≈ Presque (faute de frappe ?)", 3],
  wrong: ["ko", "✗ Ce n'est pas le sens attendu", 1],
  empty: ["ko", "✗ Pas de réponse", 1],
};

function readAutoplay() {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAutoplay(value) {
  try {
    localStorage.setItem(AUTOPLAY_KEY, value ? "1" : "0");
  } catch {
    // Stockage indisponible : le réglage ne sera pas mémorisé.
  }
}

// Modes choisis avant le test, mémorisés par exercice.
const chosenKey = (id) => `chinese.testModes.${id}`;

function readChosen(id) {
  try {
    return JSON.parse(localStorage.getItem(chosenKey(id)) || "null");
  } catch {
    return null;
  }
}

function writeChosen(id, modes) {
  try {
    localStorage.setItem(chosenKey(id), JSON.stringify(modes));
  } catch {
    // Stockage indisponible : le choix ne sera pas mémorisé.
  }
}

/**
 * Avant le test : choisir ce qu'on travaille parmi les modes de l'exercice (tracé, pinyin…).
 * Résout avec la liste des modes cochés ; directement s'il n'y a qu'un mode.
 */
function chooseModes(el, data, id) {
  const modes = data.exercise.modes.filter((m) => MODES[m]);
  const counts = data.mode_counts || {};
  const available = (m) => (counts[m]?.due || 0) + Math.min(counts[m]?.unseen || 0, data.stats.new_today);
  if (modes.length < 2) return Promise.resolve(modes);
  const saved = readChosen(id);
  const checked = (m) => (saved ? saved.includes(m) : true);

  return new Promise((resolve) => {
    el.innerHTML = `
      <div class="toolbar">
        <div>
          <h2>${escape(data.exercise.name)}</h2>
          <p class="muted small">Test · réponse attendue</p>
        </div>
      </div>
      <form class="flashcard test-setup" id="setup">
        <p class="muted">Que veux-tu travailler ?</p>
        <div class="setup-modes">
          ${modes.map((m) => {
            const due = counts[m]?.due || 0;
            const fresh = Math.min(counts[m]?.unseen || 0, data.stats.new_today);
            return `
              <label class="setup-mode${available(m) ? "" : " empty"}">
                <input type="checkbox" name="mode" value="${m}" ${checked(m) ? "checked" : ""}>
                <span class="setup-label">${escape(MODES[m].label)}
                  <small class="muted">${ANSWER_HINTS[MODES[m].answer] || ""}</small></span>
                <span class="setup-count">${available(m)
                  ? `${due ? `<span class="due">${due} à revoir</span>` : ""}${fresh ? `<span class="new">${fresh} nouv.</span>` : ""}`
                  : '<span class="muted">rien aujourd\'hui</span>'}</span>
              </label>`;
          }).join("")}
        </div>
        <div class="actions center-actions">
          <button type="button" class="secondary small-button" id="setup-all">Tout cocher</button>
          <button type="button" class="secondary small-button" id="setup-none">Tout décocher</button>
        </div>
        <button type="submit" id="setup-start">Commencer le test</button>
      </form>`;
    const form = el.querySelector("#setup");
    const boxes = [...form.querySelectorAll("[name=mode]")];
    const update = () => {
      const picked = boxes.filter((b) => b.checked);
      const start = form.querySelector("#setup-start");
      start.disabled = !picked.length;
      // La limite de nouvelles cartes par jour vaut pour l'ensemble des modes choisis.
      const due = picked.reduce((n, b) => n + (counts[b.value]?.due || 0), 0);
      const unseen = picked.reduce((n, b) => n + (counts[b.value]?.unseen || 0), 0);
      const total = due + Math.min(unseen, data.stats.new_today);
      start.textContent = picked.length ? `Commencer le test${total ? ` (${total} carte${total > 1 ? "s" : ""})` : ""}` : "Coche au moins un exercice";
    };
    boxes.forEach((b) => b.addEventListener("change", update));
    form.querySelector("#setup-all").addEventListener("click", () => {
      boxes.forEach((b) => (b.checked = true));
      update();
    });
    form.querySelector("#setup-none").addEventListener("click", () => {
      boxes.forEach((b) => (b.checked = false));
      update();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const picked = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!picked.length) return;
      writeChosen(id, picked);
      resolve(picked);
    });
    update();
  });
}

export async function playView(el, { id }) {
  let data = await api(`/exercises/${id}/session`);
  const picked = await chooseModes(el, data, id);
  if (picked.length < data.exercise.modes.length) {
    data = await api(`/exercises/${id}/session?modes=${encodeURIComponent(picked.join(","))}`);
  }
  const queue = data.cards;
  const initialCount = queue.length;
  const results = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let card = null;
  let revealed = false;
  let suggested = 3;
  let busy = false;
  let writer = null;
  let autoplay = readAutoplay();
  // Réponses en cours : tons choisis (et syllabe active), mots placés de la phrase.
  let tones = [];
  let toneSlot = 0;
  let tiles = [];
  let built = [];

  bindSpeakButtons(el);

  // Cartes réussies (une carte ratée revient dans la file et ne compte pas encore).
  const answeredCount = () => initialCount - queue.length;
  // Repli : sans syllabes alignées, les tons se donnent en pinyin ; une phrase trop courte pour
  // la remettre dans l'ordre devient une phrase à trous.
  const kind = () => {
    if (card.mode === "tones" && !card.syllables) return "pinyin";
    if (card.mode === "sentence_order" && !card.tiles) return "cloze";
    return MODES[card.mode].answer;
  };
  const choiceKind = () => kind() === "choice" || kind() === "cloze";
  const sentenceMode = () => card.mode.startsWith("sentence");

  function answerZone() {
    switch (kind()) {
      case "meaning":
        return `
          <form id="typed" class="typed">
            <input id="typed-input" autocomplete="off" spellcheck="false"
              placeholder="sens en français" aria-label="Sens en français">
            <small class="muted">Un des sens suffit ; accents et articles facultatifs</small>
          </form>`;
      case "pinyin":
        return `
          <form id="typed" class="typed">
            <input id="typed-input" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="ex. ni3 hao3" aria-label="Pinyin">
            <div id="typed-preview" class="typed-preview"></div>
            <small class="muted">Chiffre après chaque syllabe pour le ton (5 ou rien = neutre), v = ü</small>
          </form>`;
      case "tones":
        return `
          <div class="tone-slots" id="tone-slots"></div>
          <div class="tone-buttons">
            ${TONE_BUTTONS.map((t) => `
              <button type="button" class="secondary tone-button" data-tone="${t.tone}">
                ${t.label} <kbd>${t.key}</kbd></button>`).join("")}
          </div>
          <small class="muted">Tons écrits : 你好 s'entend « ní hǎo » mais s'écrit nǐ hǎo.</small>`;
      case "order":
        return `
          <div class="order-built" id="built" aria-label="Ta phrase"></div>
          <div class="order-tiles" id="tiles"></div>`;
      case "sentence":
        return `
          <form id="typed" class="typed typed-wide">
            <input id="typed-input" autocomplete="off" spellcheck="false" lang="zh"
              placeholder="汉字…" aria-label="Phrase en caractères">
            <small class="muted">Clavier 汉 : tape le pinyin et choisis les caractères ; ponctuation facultative</small>
          </form>`;
      case "cloze":
        return `
          <div class="choices">
            ${card.cloze.choices.map((w, i) => `
              <button type="button" class="secondary choice" data-choice="${escape(w)}">
                <span class="hanzi-sm">${escape(w)}</span>
                <small><kbd>${i + 1}</kbd></small>
              </button>`).join("")}
          </div>`;
      case "choice":
        return `
          <div class="choices">
            ${card.choices.map((c, i) => `
              <button type="button" class="secondary choice" data-choice="${escape(c.hanzi)}">
                <span class="hanzi-sm">${escape(c.hanzi)}</span>
                <small>${escape(c.pinyin)} <kbd>${i + 1}</kbd></small>
              </button>`).join("")}
          </div>`;
      default:
        return `
          <div id="write" class="strokes write"></div>
          <p class="muted small">Trace chaque trait dans l'ordre, case par case ;
            après 3 essais ratés, le trait attendu clignote.</p>`;
    }
  }

  function controlsBefore() {
    switch (kind()) {
      case "choice":
        return '<p class="muted">Choisis le classificateur : clic ou <kbd>1</kbd>–<kbd>4</kbd></p>';
      case "cloze":
        return '<p class="muted">Choisis le mot : clic ou <kbd>1</kbd>–<kbd>4</kbd></p>';
      case "order":
        return `<button type="button" class="secondary" id="undo">← Retirer <kbd>⌫</kbd></button>
          <button id="check">Vérifier <kbd>Entrée</kbd></button>`;
      case "strokes":
        return writer?.available === false
          ? '<button id="reveal">Afficher la réponse</button>'
          : '<button type="button" class="secondary" id="give-up">Je ne sais pas</button>';
      default:
        return '<button id="check">Vérifier <kbd>Entrée</kbd></button>';
    }
  }

  function render() {
    card = queue[0];
    if (!card) return renderEnd();
    revealed = false;
    writer = null;
    const [question, prompt] = PROMPTS[card.mode];
    const newLeft = queue.filter((c) => c.is_new).length;
    const example = card.example;

    el.innerHTML = `
      <div class="toolbar">
        <div>
          <h2>${escape(data.exercise.name)}</h2>
          <p class="muted small">Test · ${picked.length < data.exercise.modes.length
            ? `${picked.length} exercice(s) sur ${data.exercise.modes.length}` : "réponse attendue"}
            ${data.exercise.modes.length > 1 ? '<button type="button" class="link-button" id="change-modes">changer</button>' : ""}</p>
        </div>
        <label class="check small" title="Prononcer le mot quand la réponse s'affiche">
          <input type="checkbox" id="autoplay" ${autoplay ? "checked" : ""}> 🔊 auto
        </label>
        <p class="counts">
          <span class="new">${newLeft} nouvelles</span>
          <span class="due">${queue.length - newLeft} à revoir</span>
        </p>
      </div>
      <div class="progress" role="progressbar" aria-label="Progression du test"
        aria-valuenow="${answeredCount()}" aria-valuemin="0" aria-valuemax="${initialCount}">
        <div class="progress-bar" style="width: ${Math.min(100, (answeredCount() / initialCount) * 100)}%"></div>
      </div>
      <div class="flashcard">
        ${card.is_new ? '<span class="tag new">nouveau</span>' : ""}
        <p class="muted">${question}</p>
        ${prompt(card)}
        ${answerZone()}
        <div id="answer" hidden>
          <p id="verdict" class="verdict"></p>
          <hr>
          <div class="answer-word">
            <span class="big-hanzi">${escape(card.hanzi)}</span>
            ${speakButton(card.hanzi, { pinyin: card.pinyin })}
            <button type="button" id="strokes-button" class="icon-button" title="Ordre des traits"
              aria-label="Ordre des traits">✍</button>
          </div>
          <div id="strokes" class="strokes"></div>
          <div class="pinyin">${escape(card.pinyin)}</div>
          <div class="meaning">${escape(card.translation)}</div>
          ${card.measure ? `
            <div class="measure">
              <span class="hanzi-sm">${escape(card.measure.hanzi)}</span>
              ${speakButton(card.measure.hanzi)}
              <span class="muted">${escape(card.measure.pinyin)}</span>
              ${card.classifiers.length > 1 ? `<span class="muted small">· aussi
                ${card.classifiers.slice(1).map((c) => escape(c.hanzi)).join("、")}</span>` : ""}
            </div>` : ""}
          ${example ? `
            <div class="example">
              <div>${escape(example.hanzi)} ${speakButton(example.hanzi, { label: "Écouter la phrase" })}</div>
              <div class="muted">${escape(example.pinyin)}</div>
              <div>${escape(example.translation)}</div>
            </div>` : ""}
        </div>
      </div>
      <div id="controls" class="controls"></div>
      <p class="muted center small">
        Raccourcis : <kbd>Entrée</kbd> vérifier puis note suggérée · <kbd>1</kbd>–<kbd>4</kbd> note ·
        <kbd>A</kbd> écouter · <kbd>T</kbd> traits ·
        <a href="#/exercices/${id}/reviser">Mode révision</a> · <a href="#/">Quitter</a>
      </p>`;

    if (kind() === "strokes") startWriting();
    el.querySelector("#controls").innerHTML = controlsBefore();
    if (kind() === "tones") startTones();
    if (kind() === "order") startOrder();
    el.querySelector("#undo")?.addEventListener("click", undoTile);

    el.querySelector("#check")?.addEventListener("click", () => checkTyped());
    el.querySelector("#reveal")?.addEventListener("click", () =>
      reveal("partial", "Compare avec ta réponse et note-toi.", 3));
    el.querySelector("#give-up")?.addEventListener("click", giveUp);
    el.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => checkChoice(b.dataset.choice))
    );
    el.querySelector("#strokes-button").addEventListener("click", showStrokes);
    // Revenir au choix des exercices : la vue est recréée par le routeur.
    el.querySelector("#change-modes")?.addEventListener("click", () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    el.querySelector("#autoplay").addEventListener("change", (e) => {
      autoplay = e.target.checked;
      writeAutoplay(autoplay);
    });

    const input = el.querySelector("#typed-input");
    if (input) {
      if (kind() === "pinyin") {
        const preview = el.querySelector("#typed-preview");
        attachKeyboard(input, "pinyin");
        input.addEventListener("input", () => (preview.textContent = numbersToMarks(input.value)));
      } else if (kind() === "sentence") {
        attachKeyboard(input, "hanzi");
      }
      el.querySelector("#typed").addEventListener("submit", (e) => {
        e.preventDefault();
        if (revealed) answer(suggested);
        else checkTyped();
      });
      input.focus();
    }
    playPrompt();
  }

  // Ce que le mode fait entendre d'office : le mot, ou la phrase d'exemple (dictée).
  function playPrompt() {
    const audio = MODES[card.mode].audio;
    if (audio === "sentence") speak(card.example.hanzi);
    else if (audio) speak(card.hanzi, card.pinyin);
  }

  // --- Tons : une case par syllabe, remplie avec les boutons ou les touches 1–5 ---
  function startTones() {
    tones = card.syllables.map(() => null);
    toneSlot = 0;
    renderTones();
    el.querySelectorAll("[data-tone]").forEach((b) =>
      b.addEventListener("click", () => setTone(Number(b.dataset.tone))));
  }

  function renderTones(results = null) {
    el.querySelector("#tone-slots").innerHTML = card.syllables.map((s, i) => {
      const chosen = tones[i];
      const state = results ? (results[i] ? "ok" : "ko") : i === toneSlot ? "active" : "";
      let shown = chosen === null ? s.base.replace(/v/g, "ü") : withTone(s.base, chosen);
      let note = chosen === null ? "?" : toneName(chosen);
      if (results) {
        shown = withTone(s.base, s.tone);
        note = results[i] ? toneName(s.tone) : `et non ${escape(withTone(s.base, chosen))}`;
      }
      return `<button type="button" class="tone-slot ${state}" data-slot="${i}" ${results ? "disabled" : ""}>
        <span class="hanzi-sm" lang="zh">${escape(s.hanzi)}</span>
        <span class="syllable">${escape(shown)}</span>
        <small>${note}</small>
      </button>`;
    }).join("");
    if (results) return;
    el.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => {
      toneSlot = Number(b.dataset.slot);
      renderTones();
    }));
  }

  function setTone(tone) {
    if (revealed) return;
    tones[toneSlot] = tone;
    const next = tones.findIndex((t, i) => t === null && i > toneSlot);
    const firstEmpty = tones.indexOf(null);
    if (next >= 0) toneSlot = next;
    else if (firstEmpty >= 0) toneSlot = firstEmpty;
    renderTones();
  }

  function checkTones() {
    if (revealed) return;
    if (tones.includes(null)) {
      toast("Choisis le ton de chaque syllabe", "error");
      return;
    }
    const results = card.syllables.map((s, i) => s.tone === tones[i]);
    const wrong = results.filter((ok) => !ok).length;
    renderTones(results);
    el.querySelectorAll("[data-tone]").forEach((b) => (b.disabled = true));
    const expected = escape(card.syllables.map((s) => withTone(s.base, s.tone)).join(" "));
    if (!wrong) reveal("ok", "✓ Tous les tons sont justes", 3);
    else if (wrong === 1 && results.length >= 3) reveal("partial", `≈ Un ton faux — attendu : <strong>${expected}</strong>`, 2);
    else reveal("ko", `✗ Tons attendus : <strong>${expected}</strong>`, 1);
  }

  // --- Phrase à remettre dans l'ordre : on clique les mots (ou leur numéro) un par un ---
  function startOrder() {
    const words = card.tiles.map((text, index) => ({ text, index }));
    tiles = shuffled(words);
    // Pas de mélange qui redonnerait la phrase telle quelle.
    for (let tries = 0; tries < 5 && tiles.every((t, i) => t.text === card.tiles[i]); tries += 1) {
      tiles = shuffled(words);
    }
    built = [];
    renderOrder();
  }

  function renderOrder(correct = null) {
    const done = correct !== null;
    el.querySelector("#built").innerHTML = built.length
      ? built.map((n, i) => `<button type="button" class="tile placed ${done ? (correct ? "ok" : "ko") : ""}"
          data-placed="${i}" lang="zh" ${done ? "disabled" : ""}>${escape(tiles[n].text)}</button>`).join("")
      : '<span class="muted small">Clique les mots dans l’ordre</span>';
    el.querySelector("#tiles").innerHTML = tiles.map((t, n) => `
      <button type="button" class="secondary tile" data-tile="${n}" lang="zh"
        ${built.includes(n) || done ? "disabled" : ""}>${escape(t.text)} <kbd>${n + 1}</kbd></button>`).join("");
    if (done) return;
    el.querySelectorAll("[data-tile]").forEach((b) =>
      b.addEventListener("click", () => placeTile(Number(b.dataset.tile))));
    el.querySelectorAll("[data-placed]").forEach((b) => b.addEventListener("click", () => {
      built.splice(Number(b.dataset.placed), 1);
      renderOrder();
    }));
  }

  function placeTile(n) {
    if (revealed || n < 0 || n >= tiles.length || built.includes(n)) return;
    built.push(n);
    renderOrder();
  }

  function undoTile() {
    if (revealed || !built.length) return;
    built.pop();
    renderOrder();
  }

  function checkOrder() {
    if (revealed) return;
    if (built.length < tiles.length) {
      toast("Place tous les mots", "error");
      return;
    }
    // Comparaison du texte : deux mots identiques peuvent s'échanger.
    const correct = built.map((n) => tiles[n].text).join("") === card.tiles.join("");
    renderOrder(correct);
    el.querySelector("#undo")?.remove();
    reveal(correct ? "ok" : "ko", correct ? "✓ Phrase correcte"
      : `✗ Ordre attendu : <strong lang="zh">${escape(card.tiles.join(" "))}</strong>`, correct ? 3 : 1);
  }

  // Dictée de phrase : caractères retrouvés dans l'ordre (plus longue sous-suite commune).
  function checkSentence(input) {
    const expected = sentenceChars(card.example.hanzi);
    const given = sentenceChars(input.value);
    input.readOnly = true;
    input.blur();
    if (!given.length) return reveal("ko", "✗ Pas de réponse", 1);
    const found = matchedIndices(expected, given);
    const exact = found.size === expected.length && given.length === expected.length;
    const ratio = found.size / Math.max(expected.length, given.length);
    const corrected = expected
      .map((ch, i) => (found.has(i) ? escape(ch) : `<mark class="miss">${escape(ch)}</mark>`)).join("");
    const yours = `<br><small>ta réponse : <span lang="zh">${escape(input.value.trim())}</span></small>`;
    if (exact) return reveal("ok", "✓ Dictée sans faute", 3);
    if (ratio >= 0.75) return reveal("partial", `≈ Presque : <span lang="zh">${corrected}</span>${yours}`, 2);
    return reveal("ko", `✗ Phrase attendue : <span lang="zh">${corrected}</span>${yours}`, 1);
  }

  // Caractères à tracer de mémoire (sans modèle grisé), dans l'ordre des traits.
  function startWriting() {
    const size = Math.min(150, Math.floor((el.clientWidth - 48) / Math.max(1, [...card.hanzi].length)));
    writer = mountStrokes(el.querySelector("#write"), card.hanzi, Math.max(90, size), { outline: false });
    if (!writer.available) return;
    const chars = [...card.hanzi].filter((ch) => /[一-鿿]/.test(ch)).length || 1;
    writer.quiz((mistakes) => {
      if (revealed) return;
      if (mistakes === 0) reveal("ok", "✓ Tracé sans erreur", 3);
      else if (mistakes <= chars * 2) reveal("partial", `≈ Tracé avec ${mistakes} erreur(s)`, 2);
      else reveal("ko", `✗ ${mistakes} erreurs de tracé`, 1);
    });
  }

  function giveUp() {
    writer?.reveal();
    reveal("ko", "✗ Réponse donnée", 1);
  }

  function checkTyped() {
    if (kind() === "tones") return checkTones();
    if (kind() === "order") return checkOrder();
    const input = el.querySelector("#typed-input");
    if (!input || revealed) return;
    if (kind() === "sentence") return checkSentence(input);
    const value = input.value;
    const [cls, text, grade] = kind() === "pinyin"
      ? PINYIN_VERDICTS[checkPinyin(value, card.pinyin)]
      : MEANING_VERDICTS[checkMeaning(value, card.translation)];
    const shown = kind() === "pinyin" ? numbersToMarks(value) : value.trim();
    input.readOnly = true;
    input.blur();
    reveal(cls, cls === "ok" || !shown ? text : `${text} — ta réponse : <strong>${escape(shown)}</strong>`, grade);
  }

  function checkChoice(chosen) {
    if (revealed) return;
    if (kind() === "cloze") {
      const correct = chosen === card.hanzi;
      el.querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (b.dataset.choice === card.hanzi) b.classList.add("ok");
        else if (b.dataset.choice === chosen) b.classList.add("ko");
      });
      el.querySelector(".blank").textContent = card.hanzi;
      reveal(correct ? "ok" : "ko", correct ? "✓ Correct" : `✗ C'est ${escape(card.hanzi)}`, correct ? 3 : 1);
      return;
    }
    const valid = card.classifiers.map((c) => c.hanzi);
    const correct = valid.includes(chosen);
    el.querySelectorAll("[data-choice]").forEach((b) => {
      b.disabled = true;
      if (valid.includes(b.dataset.choice)) b.classList.add("ok");
      else if (b.dataset.choice === chosen) b.classList.add("ko");
    });
    el.querySelector(".blank").textContent = card.classifiers[0].hanzi;
    reveal(correct ? "ok" : "ko", correct ? "✓ Correct" : `✗ C'est ${escape(card.classifiers[0].hanzi)}`,
      correct ? 3 : 1);
  }

  function showStrokes() {
    mountStrokes(el.querySelector("#strokes"), card.hanzi, 90).animate();
  }

  // Ce que l'on prononce : « 一本书 » pour le mode classificateur une fois la réponse
  // affichée, le mot sinon.
  // Modes sur les phrases : la phrase d'exemple (une fois la réponse affichée, ou en dictée).
  const spokenText = () => {
    if (revealed && kind() === "choice" && card.measure) return card.measure.hanzi;
    if (sentenceMode() && (revealed || MODES[card.mode].audio === "sentence")) return card.example.hanzi;
    return card.hanzi;
  };
  const spokenPinyin = () => (spokenText() === card.hanzi ? card.pinyin : undefined);

  /** Affiche le verdict, la réponse complète et les notes (celle suggérée en évidence). */
  function reveal(cls, html, grade) {
    if (revealed) return;
    revealed = true;
    suggested = grade;
    const verdict = el.querySelector("#verdict");
    verdict.className = `verdict ${cls}`;
    verdict.innerHTML = html;
    el.querySelector("#answer").hidden = false;
    if (autoplay && !MODES[card.mode].audio) speak(spokenText(), spokenPinyin());
    el.querySelector("#controls").innerHTML = GRADES.map((g) => `
      <button class="grade ${g.cls} ${g.grade === suggested ? "suggested" : ""}" data-grade="${g.grade}">
        <span>${g.label}</span>
        <small>${card.previews[g.grade]} · <kbd>${g.key}</kbd>${g.grade === suggested ? " <kbd>Entrée</kbd>" : ""}</small>
      </button>`).join("");
    el.querySelectorAll("[data-grade]").forEach((b) =>
      b.addEventListener("click", () => answer(Number(b.dataset.grade)))
    );
    el.querySelector("#controls .suggested")?.scrollIntoView({ block: "nearest" });
  }

  async function answer(grade) {
    if (!revealed || busy) return;
    busy = true;
    el.querySelectorAll("#controls button").forEach((b) => (b.disabled = true));
    try {
      const updated = await api("/reviews", {
        method: "POST",
        body: { word_id: card.word_id, mode: card.mode, grade },
      });
      // Sans compte, la première réponse a créé la progression d'invité (cookie).
      if (!session.user) session.guest = true;
      results[grade] += 1;
      queue.shift();
      // La carte reprogrammée garde son exemple (non renvoyé par l'API de révision).
      if (grade === 1) queue.splice(Math.min(REQUEUE_OFFSET, queue.length), 0, { ...card, ...updated });
      render();
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
      el.querySelectorAll("#controls button").forEach((b) => (b.disabled = false));
    } finally {
      busy = false;
    }
  }

  function renderEnd() {
    const total = Object.values(results).reduce((a, b) => a + b, 0);
    el.innerHTML = `
      <div class="flashcard">
        <div class="big-hanzi">${total ? "太好了！" : "✓"}</div>
        <p>${total
          ? `Test terminé : ${total} réponse(s).`
          : "Rien à tester pour le moment dans cet exercice : reviens plus tard, ou révise-le sans pression."}</p>
        ${total ? `<p class="counts">
          ${GRADES.map((g) => `<span class="${g.cls}">${g.label} : ${results[g.grade]}</span>`).join("")}
        </p>` : ""}
      </div>
      <p class="center actions center-actions">
        <a class="button secondary" href="#/exercices/${id}/reviser">Mode révision</a>
        <a class="button" href="#/">Retour aux exercices</a>
      </p>`;
  }

  function onKey(e) {
    if (e.target.matches?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!card) return;
    const mode = MODES[card.mode];
    if (key === "a" && (revealed || mode.audio || mode.listen)) {
      speak(spokenText(), spokenPinyin());
    } else if (key === "t" && revealed) {
      showStrokes();
    } else if (!revealed && choiceKind()) {
      const button = el.querySelectorAll("[data-choice]")[Number(e.key) - 1];
      if (button) checkChoice(button.dataset.choice);
    } else if (!revealed && kind() === "tones") {
      const tone = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 0, 0: 0 }[e.key];
      if (tone !== undefined) {
        setTone(tone);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        toneSlot = Math.max(0, Math.min(tones.length - 1, toneSlot + (e.key === "ArrowLeft" ? -1 : 1)));
        renderTones();
      } else if (e.key === "Enter") {
        e.preventDefault();
        checkTones();
      }
    } else if (!revealed && kind() === "order") {
      if (/^[1-9]$/.test(e.key)) {
        placeTile(Number(e.key) - 1);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undoTile();
      } else if (e.key === "Enter") {
        e.preventDefault();
        checkOrder();
      }
    } else if (revealed && e.key === "Enter") {
      e.preventDefault();
      answer(suggested);
    } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      answer(Number(e.key));
    }
  }

  document.addEventListener("keydown", onKey);
  render();
  return () => {
    writer?.cancel();
    document.removeEventListener("keydown", onKey);
    stopSpeaking();
  };
}
