import { api, escape } from "../api.js";
import { bindSpeakButtons, speak, speakButton, stopSpeaking } from "../audio.js";
import { mountStrokes } from "../strokes.js";

// Mode révision : les mots défilent avec tout ce qu'il faut retenir (caractères, pinyin, sens,
// prononciation, classificateur, exemple). Aucune réponse attendue, rien n'est noté.

const SETTINGS_KEY = "chinese.study";
const SPEEDS = [3, 5, 8, 12];

function readSettings() {
  try {
    return { autoplay: true, speed: 5, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { autoplay: true, speed: 5 };
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : réglages non mémorisés.
  }
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function studyView(el, { id }) {
  const { exercise, words: allWords } = await api(`/exercises/${id}/words`);
  const settings = readSettings();
  const positionKey = `chinese.study.${id}`;
  let words = allWords;
  let index = 0;
  let playing = false;
  let timer = null;
  try {
    index = Math.min(Number(sessionStorage.getItem(positionKey)) || 0, Math.max(0, words.length - 1));
  } catch {
    index = 0;
  }

  bindSpeakButtons(el);

  if (!words.length) {
    el.innerHTML = `<div class="empty"><p>Cet exercice ne contient encore aucun mot.</p>
      <p><a href="#/">Retour aux exercices</a></p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>${escape(exercise.name)}</h2>
        <p class="muted small">Révision · sans note, à ton rythme</p>
      </div>
      <div class="study-settings">
        <label class="check small" title="Prononcer chaque mot">
          <input type="checkbox" id="autoplay" ${settings.autoplay ? "checked" : ""}> 🔊 auto
        </label>
        <button type="button" class="secondary small-button" id="shuffle" title="Mélanger les mots">🔀 Mélanger</button>
        <button type="button" class="secondary small-button" id="play" title="Faire défiler les mots (P)">▶ Défiler</button>
        <select id="speed" aria-label="Durée par mot">
          ${SPEEDS.map((s) => `<option value="${s}" ${s === settings.speed ? "selected" : ""}>${s} s</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="progress" aria-hidden="true"><div class="progress-bar" id="bar"></div></div>
    <div class="flashcard study-card" id="card" aria-live="polite"></div>
    <div class="controls">
      <button type="button" class="secondary" id="prev">← Précédent</button>
      <button type="button" id="next">Suivant →</button>
    </div>
    <p class="muted center small">
      Raccourcis : <kbd>←</kbd> <kbd>→</kbd> ou <kbd>Espace</kbd> · <kbd>A</kbd> écouter ·
      <kbd>T</kbd> traits · <kbd>P</kbd> défilement ·
      <a href="#/exercices/${id}/test">Passer au test</a> · <a href="#/">Quitter</a>
    </p>`;

  const card = el.querySelector("#card");

  function render() {
    try {
      sessionStorage.setItem(positionKey, String(index));
    } catch {
      // Position non mémorisée.
    }
    const w = words[index];
    el.querySelector("#bar").style.width = `${((index + 1) / words.length) * 100}%`;
    el.querySelector("#prev").disabled = index === 0;
    el.querySelector("#next").textContent = index === words.length - 1 ? "Terminer ✓" : "Suivant →";
    card.innerHTML = `
      <span class="tag">${index + 1} / ${words.length}</span>
      <div class="answer-word">
        <span class="big-hanzi">${escape(w.hanzi)}</span>
        ${speakButton(w.hanzi, { pinyin: w.pinyin })}
        <button type="button" class="icon-button" data-strokes title="Ordre des traits (T)"
          aria-label="Ordre des traits">✍</button>
      </div>
      <div class="strokes" id="strokes"></div>
      <div class="pinyin">${escape(w.pinyin)}</div>
      <div class="meaning">${escape(w.translation)}</div>
      ${w.measure ? `
        <div class="measure" title="Classificateur">
          <span class="muted small">量词</span>
          <span class="hanzi-sm">${escape(w.measure.hanzi)}</span>
          ${speakButton(w.measure.hanzi)}
          <span class="muted">${escape(w.measure.pinyin)}</span>
          ${w.classifiers.length > 1 ? `<span class="muted small">· aussi
            ${w.classifiers.slice(1).map((c) => escape(c.hanzi)).join("、")}</span>` : ""}
        </div>` : ""}
      ${w.example ? `
        <div class="example">
          <div>${escape(w.example.hanzi)} ${speakButton(w.example.hanzi, { label: "Écouter la phrase" })}</div>
          <div class="muted">${escape(w.example.pinyin)}</div>
          <div>${escape(w.example.translation)}</div>
        </div>` : ""}`;
    card.querySelector("[data-strokes]").addEventListener("click", showStrokes);
    if (settings.autoplay) speak(w.hanzi, w.pinyin);
    schedule();
  }

  function showStrokes() {
    mountStrokes(card.querySelector("#strokes"), words[index].hanzi, 90).animate();
  }

  function renderEnd() {
    stop();
    card.innerHTML = `
      <div class="big-hanzi">✓</div>
      <p>Tu as parcouru les ${words.length} mot(s) de l'exercice.</p>
      <div class="actions center-actions">
        <button type="button" class="secondary" id="again">Recommencer</button>
        <a class="button" href="#/exercices/${id}/test">Passer au test</a>
      </div>`;
    card.querySelector("#again").addEventListener("click", () => go(0));
    el.querySelector("#next").disabled = true;
    el.querySelector("#prev").disabled = false;
    index = words.length;
    try {
      sessionStorage.removeItem(positionKey);
    } catch {
      // Rien à effacer.
    }
  }

  function go(target) {
    el.querySelector("#next").disabled = false;
    if (target >= words.length) return renderEnd();
    index = Math.max(0, target);
    render();
  }

  // Défilement automatique : un mot toutes les `speed` secondes.
  function schedule() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(() => go(index + 1), settings.speed * 1000);
  }

  function setPlaying(value) {
    playing = value;
    el.querySelector("#play").textContent = playing ? "⏸ Pause" : "▶ Défiler";
    el.querySelector("#play").classList.toggle("active", playing);
    if (playing && index >= words.length) go(0);
    else schedule();
  }

  function stop() {
    if (playing) setPlaying(false);
  }

  el.querySelector("#prev").addEventListener("click", () => go(Math.min(index, words.length) - 1));
  el.querySelector("#next").addEventListener("click", () => go(index + 1));
  el.querySelector("#play").addEventListener("click", () => setPlaying(!playing));
  el.querySelector("#speed").addEventListener("change", (e) => {
    settings.speed = Number(e.target.value);
    writeSettings(settings);
    schedule();
  });
  el.querySelector("#autoplay").addEventListener("change", (e) => {
    settings.autoplay = e.target.checked;
    writeSettings(settings);
  });
  el.querySelector("#shuffle").addEventListener("click", () => {
    words = shuffle(allWords);
    go(0);
  });

  function onKey(e) {
    if (e.target.matches?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      if (index < words.length) go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) go(Math.min(index, words.length) - 1);
    } else if (key === "p") {
      setPlaying(!playing);
    } else if (index < words.length && key === "a") {
      speak(words[index].hanzi, words[index].pinyin);
    } else if (index < words.length && key === "t") {
      showStrokes();
    }
  }

  // Sur téléphone : glisser vers la gauche ou la droite pour changer de mot.
  let touchStart = null;
  card.addEventListener("touchstart", (e) => {
    touchStart = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null;
  }, { passive: true });
  card.addEventListener("touchend", (e) => {
    if (!touchStart || index >= words.length) return;
    const dx = e.changedTouches[0].clientX - touchStart[0];
    const dy = e.changedTouches[0].clientY - touchStart[1];
    touchStart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) go(index + 1);
    else if (index > 0) go(index - 1);
  });

  document.addEventListener("keydown", onKey);
  render();
  return () => {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    stopSpeaking();
  };
}
