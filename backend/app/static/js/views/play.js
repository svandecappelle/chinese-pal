import { api, escape, MODES } from "../api.js";
import { bindSpeakButtons, speak, speakButton, stopSpeaking } from "../audio.js";
import { attachKeyboard } from "../keyboard.js";
import { checkPinyin, numbersToMarks } from "../pinyin.js";
import { mountStrokes } from "../strokes.js";
import { toast } from "../ui.js";

const GRADES = [
  { grade: 1, label: "À revoir", key: "1", cls: "again" },
  { grade: 2, label: "Difficile", key: "2", cls: "hard" },
  { grade: 3, label: "Bien", key: "3", cls: "good" },
  { grade: 4, label: "Facile", key: "4", cls: "easy" },
];

// Une carte ratée revient après quelques autres cartes de la session.
const REQUEUE_OFFSET = 3;
const AUTOPLAY_KEY = "chinese.autoplay";

// Question et élément affiché pour chaque mode.
const PROMPTS = {
  hanzi_to_meaning: ["Que signifie ce mot ?", (c) => bigHanzi(c)],
  pinyin_to_meaning: ["Quel est ce mot ?", (c) => `<div class="big-pinyin">${escape(c.pinyin)}</div>`],
  audio_to_meaning: ["Qu'entends-tu ?", (c) => `
    <button type="button" class="big-audio" data-speak="${escape(c.hanzi)}"
      data-pinyin="${escape(c.pinyin)}" aria-label="Réécouter">🔊</button>
    <small class="muted">Touche <kbd>A</kbd> pour réécouter</small>`],
  meaning_to_hanzi: ["Comment l'écrit-on en chinois ?", (c) => bigMeaning(c)],
  hanzi_to_pinyin: ["Tape le pinyin avec les tons", (c) => bigHanzi(c)],
  meaning_to_pinyin: ["Tape le pinyin avec les tons", (c) => bigMeaning(c)],
  classifier: ["Quel classificateur ?", (c) => `
    <div class="big-hanzi">一<span class="blank">？</span>${escape(c.hanzi)}</div>
    <div class="muted">${escape(c.pinyin)} · ${escape(c.translation)}</div>`],
};

const bigHanzi = (c) => `<div class="big-hanzi">${escape(c.hanzi)}</div>`;
const bigMeaning = (c) => `<div class="big-meaning">${escape(c.translation)}</div>`;

const VERDICTS = {
  correct: ["ok", "✓ Correct"],
  tones: ["partial", "≈ Bonnes syllabes, tons incorrects"],
  wrong: ["ko", "✗ Incorrect"],
  empty: ["ko", "✗ Pas de réponse"],
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
  const session = await api(`/exercises/${id}/session`);
  const queue = session.cards;
  const initialCount = queue.length;
  const results = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let card = null;
  let revealed = false;
  let suggested = 3;
  let busy = false;
  let autoplay = readAutoplay();

  bindSpeakButtons(el);

  // Cartes réussies (une carte ratée revient dans la file et ne compte pas encore).
  const answeredCount = () => initialCount - queue.length;

  function render() {
    card = queue[0];
    if (!card) return renderEnd();
    revealed = false;
    const { typed, audio, choice } = MODES[card.mode];
    const [question, prompt] = PROMPTS[card.mode];
    const newLeft = queue.filter((c) => c.is_new).length;
    const example = card.example;

    el.innerHTML = `
      <div class="toolbar">
        <h2>${escape(session.exercise.name)}</h2>
        <label class="check small" title="Prononcer le mot quand la réponse s'affiche">
          <input type="checkbox" id="autoplay" ${autoplay ? "checked" : ""}> 🔊 auto
        </label>
        <p class="counts">
          <span class="new">${newLeft} nouvelles</span>
          <span class="due">${queue.length - newLeft} à revoir</span>
        </p>
      </div>
      <div class="progress" role="progressbar" aria-label="Progression de la session"
        aria-valuenow="${answeredCount()}" aria-valuemin="0" aria-valuemax="${initialCount}">
        <div class="progress-bar" style="width: ${Math.min(100, (answeredCount() / initialCount) * 100)}%"></div>
      </div>
      <div class="flashcard">
        ${card.is_new ? '<span class="tag new">nouveau</span>' : ""}
        <p class="muted">${question}</p>
        ${prompt(card)}
        ${typed ? `
          <form id="typed" class="typed">
            <input id="typed-input" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="ex. ni3 hao3" aria-label="Pinyin">
            <div id="typed-preview" class="typed-preview"></div>
            <small class="muted">Chiffre après chaque syllabe pour le ton (5 ou rien = neutre), v = ü</small>
          </form>` : ""}
        ${choice ? `
          <div class="choices">
            ${card.choices.map((c, i) => `
              <button type="button" class="secondary choice" data-choice="${escape(c.hanzi)}">
                <span class="hanzi-sm">${escape(c.hanzi)}</span>
                <small>${escape(c.pinyin)} <kbd>${i + 1}</kbd></small>
              </button>`).join("")}
          </div>` : ""}
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
      <div id="controls" class="controls">
        ${choice
          ? '<p class="muted">Choisis le classificateur : clic ou <kbd>1</kbd>–<kbd>4</kbd></p>'
          : `<button id="reveal">${typed ? "Vérifier <kbd>Entrée</kbd>" : "Afficher la réponse <kbd>Espace</kbd>"}</button>`}
      </div>
      <p class="muted center small">
        Raccourcis : <kbd>Espace</kbd> réponse · <kbd>1</kbd>–<kbd>4</kbd> note ·
        <kbd>A</kbd> écouter · <kbd>T</kbd> traits · <a href="#/">Quitter</a>
      </p>`;

    el.querySelector("#reveal")?.addEventListener("click", () => reveal());
    el.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => reveal(b.dataset.choice))
    );
    el.querySelector("#strokes-button").addEventListener("click", showStrokes);
    el.querySelector("#autoplay").addEventListener("change", (e) => {
      autoplay = e.target.checked;
      writeAutoplay(autoplay);
    });
    if (typed) {
      const input = el.querySelector("#typed-input");
      const preview = el.querySelector("#typed-preview");
      attachKeyboard(input, "pinyin");
      input.addEventListener("input", () => (preview.textContent = numbersToMarks(input.value)));
      el.querySelector("#typed").addEventListener("submit", (e) => {
        e.preventDefault();
        reveal();
      });
      input.focus();
    }
    if (audio) speak(card.hanzi, card.pinyin);
  }

  function showStrokes() {
    const container = el.querySelector("#strokes");
    mountStrokes(container, card.hanzi, 90).animate();
  }

  // Ce que l'on prononce : « 一本书 » pour le mode classificateur, le mot sinon.
  const spokenText = () => (MODES[card.mode].choice && card.measure ? card.measure.hanzi : card.hanzi);
  const spokenPinyin = () => (MODES[card.mode].choice ? undefined : card.pinyin);

  /** Affiche la réponse ; `chosen` : classificateur choisi (mode classificateur). */
  function reveal(chosen) {
    if (revealed) return;
    if (MODES[card.mode].choice && chosen === undefined) return;
    revealed = true;
    suggested = 3;

    if (chosen !== undefined) {
      const valid = card.classifiers.map((c) => c.hanzi);
      const correct = valid.includes(chosen);
      el.querySelectorAll("[data-choice]").forEach((b) => {
        b.disabled = true;
        if (valid.includes(b.dataset.choice)) b.classList.add("ok");
        else if (b.dataset.choice === chosen) b.classList.add("ko");
      });
      el.querySelector(".blank").textContent = card.classifiers[0].hanzi;
      const verdict = el.querySelector("#verdict");
      verdict.className = `verdict ${correct ? "ok" : "ko"}`;
      verdict.textContent = correct ? "✓ Correct" : `✗ C'est ${card.classifiers[0].hanzi}`;
      suggested = correct ? 3 : 1;
    }

    const input = el.querySelector("#typed-input");
    if (input) {
      const result = checkPinyin(input.value, card.pinyin);
      const [cls, text] = VERDICTS[result];
      const verdict = el.querySelector("#verdict");
      verdict.className = `verdict ${cls}`;
      verdict.innerHTML = result === "correct" || result === "empty"
        ? text
        : `${text} — ta réponse : <strong>${escape(numbersToMarks(input.value))}</strong>`;
      suggested = result === "correct" ? 3 : 1;
      input.readOnly = true;
      input.blur();
    }

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
          ? `Session terminée : ${total} réponse(s).`
          : "Rien à réviser pour le moment dans cet exercice."}</p>
        ${total ? `<p class="counts">
          ${GRADES.map((g) => `<span class="${g.cls}">${g.label} : ${results[g.grade]}</span>`).join("")}
        </p>` : ""}
      </div>
      <p class="center"><a class="button" href="#/">Retour aux exercices</a></p>`;
  }

  function onKey(e) {
    if (e.target.matches("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!card) return;
    if (key === "a" && (revealed || MODES[card.mode].audio)) {
      speak(spokenText(), spokenPinyin());
    } else if (key === "t" && revealed) {
      showStrokes();
    } else if (!revealed && MODES[card.mode].choice) {
      const button = el.querySelectorAll("[data-choice]")[Number(e.key) - 1];
      if (button) reveal(button.dataset.choice);
    } else if (!revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      reveal();
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
    document.removeEventListener("keydown", onKey);
    stopSpeaking();
  };
}
