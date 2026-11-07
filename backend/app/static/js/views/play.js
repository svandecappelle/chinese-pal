import { api, escape, MODES } from "../api.js";
import { checkMeaning } from "../answers.js";
import { bindSpeakButtons, speak, speakButton, stopSpeaking } from "../audio.js";
import { attachKeyboard } from "../keyboard.js";
import { checkPinyin, numbersToMarks } from "../pinyin.js";
import { session } from "../session.js";
import { mountStrokes } from "../strokes.js";
import { toast } from "../ui.js";

// Mode test : chaque carte attend une réponse (sens tapé, pinyin, caractères tracés,
// classificateur), vérifiée puis notée pour la répétition espacée.

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

// Question et élément présenté pour chaque mode.
const PROMPTS = {
  hanzi_to_meaning: ["Que signifie ce mot ?", (c) => `${bigHanzi(c)}${listenButton(c)}`],
  pinyin_to_meaning: ["Que signifie ce mot ?", (c) => `
    <div class="big-pinyin">${escape(c.pinyin)}</div>${listenButton(c)}`],
  audio_to_meaning: ["Qu'entends-tu ? Donne le sens", (c) => `
    <button type="button" class="big-audio" data-speak="${escape(c.hanzi)}"
      data-pinyin="${escape(c.pinyin)}" aria-label="Réécouter">🔊</button>
    <small class="muted">Touche <kbd>A</kbd> pour réécouter</small>`],
  meaning_to_hanzi: ["Écris-le en chinois, trait par trait", (c) => `${bigMeaning(c)}
    <div class="muted small">${[...c.hanzi].filter((ch) => /[一-鿿]/.test(ch)).length} caractère(s)
      · ${listenButton(c)}</div>`],
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

export async function playView(el, { id }) {
  const data = await api(`/exercises/${id}/session`);
  const queue = data.cards;
  const initialCount = queue.length;
  const results = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let card = null;
  let revealed = false;
  let suggested = 3;
  let busy = false;
  let writer = null;
  let autoplay = readAutoplay();

  bindSpeakButtons(el);

  // Cartes réussies (une carte ratée revient dans la file et ne compte pas encore).
  const answeredCount = () => initialCount - queue.length;
  const kind = () => MODES[card.mode].answer;

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
          <p class="muted small">Test · réponse attendue</p>
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

    el.querySelector("#check")?.addEventListener("click", () => checkTyped());
    el.querySelector("#reveal")?.addEventListener("click", () =>
      reveal("partial", "Compare avec ta réponse et note-toi.", 3));
    el.querySelector("#give-up")?.addEventListener("click", giveUp);
    el.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => checkChoice(b.dataset.choice))
    );
    el.querySelector("#strokes-button").addEventListener("click", showStrokes);
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
      }
      el.querySelector("#typed").addEventListener("submit", (e) => {
        e.preventDefault();
        if (revealed) answer(suggested);
        else checkTyped();
      });
      input.focus();
    }
    if (MODES[card.mode].audio) speak(card.hanzi, card.pinyin);
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
    const input = el.querySelector("#typed-input");
    if (!input || revealed) return;
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
  const spokenText = () => (revealed && kind() === "choice" && card.measure ? card.measure.hanzi : card.hanzi);
  const spokenPinyin = () => (revealed && kind() === "choice" ? undefined : card.pinyin);

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
    } else if (!revealed && kind() === "choice") {
      const button = el.querySelectorAll("[data-choice]")[Number(e.key) - 1];
      if (button) checkChoice(button.dataset.choice);
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
