import { api, escape } from "../api.js";
import { bindSpeakButtons, speak, speakButton, stopSpeaking } from "../audio.js";
import { mountStrokes } from "../strokes.js";

// Mode révision : les mots défilent avec tout ce qu'il faut retenir (caractères, pinyin, sens,
// prononciation, classificateur, exemple). Aucune réponse attendue, rien n'est noté.
// On peut choisir ce qu'on travaille : cette partie reste cachée jusqu'à ce qu'on la dévoile.

const SETTINGS_KEY = "chinese.study";
const SPEEDS = [3, 5, 8, 12];
// Ce qu'on travaille : parties cachées (hanzi, pinyin, meaning, measure, example) et, au besoin,
// mots concernés.
const FOCUS = {
  all: { label: "Tout voir", hide: [] },
  meaning: { label: "Le sens", hide: ["meaning", "example"] },
  hanzi: { label: "Les caractères", hide: ["hanzi", "example"] },
  pinyin: { label: "Le pinyin", hide: ["pinyin", "example"] },
  listen: { label: "L'écoute", hide: ["hanzi", "pinyin", "meaning", "measure", "example"], listen: true },
  strokes: { label: "Le tracé", hide: [], strokes: true },
  classifier: { label: "Le classificateur", hide: ["measure"], only: (w) => w.measure },
};

function readSettings() {
  const defaults = { autoplay: true, speed: 5, focus: "all" };
  try {
    const settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    if (!FOCUS[settings.focus]) settings.focus = "all";
    return settings;
  } catch {
    return defaults;
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
  // Sans exercice : les mots les plus ratés (depuis les statistiques).
  const { exercise, words: allWords } = await api(id ? `/exercises/${id}/words` : "/stats/difficult-words");
  const settings = readSettings();
  const positionKey = `chinese.study.${id ?? "difficult"}`;
  const testLink = id ? `<a href="#/exercices/${id}/test">Passer au test</a>` : '<a href="#/statistiques">Mes statistiques</a>';
  const focusWords = () => (FOCUS[settings.focus].only ? allWords.filter(FOCUS[settings.focus].only) : allWords);
  let words = focusWords();
  let index = 0;
  let playing = false;
  let timer = null;
  let revealed = true;
  let practice = null;
  try {
    index = Math.min(Number(sessionStorage.getItem(positionKey)) || 0, Math.max(0, words.length - 1));
  } catch {
    index = 0;
  }

  bindSpeakButtons(el);

  if (!allWords.length) {
    el.innerHTML = `<div class="empty"><p>${id ? "Cet exercice ne contient encore aucun mot." : "Aucun mot raté ces 90 derniers jours."}</p>
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
        <label class="small study-focus">Travailler
          <select id="focus" aria-label="Ce que tu travailles">
            ${Object.entries(FOCUS).map(([v, f]) => `<option value="${v}" ${v === settings.focus ? "selected" : ""}>${f.label}</option>`).join("")}
          </select>
        </label>
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
      Raccourcis : <kbd>←</kbd> <kbd>→</kbd> ou <kbd>Espace</kbd> (dévoiler puis suivant) · <kbd>A</kbd> écouter ·
      <kbd>T</kbd> traits · <kbd>P</kbd> défilement ·
      ${testLink} · <a href="#/">Quitter</a>
    </p>`;

  const card = el.querySelector("#card");

  function render() {
    try {
      sessionStorage.setItem(positionKey, String(index));
    } catch {
      // Position non mémorisée.
    }
    practice?.cancel();
    practice = null;
    const w = words[index];
    const focus = FOCUS[settings.focus];
    // Partie cachée tant qu'on ne l'a pas dévoilée (clic, Espace ou →).
    const hidden = focus.hide.filter((part) => part !== "measure" || w.measure).filter((part) => part !== "example" || w.example);
    revealed = !hidden.length;
    const part = (name, html) => (html ? `<div class="study-part ${hidden.includes(name) ? "concealed" : ""}"
      data-part="${name}" ${hidden.includes(name) ? 'title="Clique pour dévoiler"' : ""}>${html}</div>` : "");
    el.querySelector("#bar").style.width = `${((index + 1) / words.length) * 100}%`;
    el.querySelector("#prev").disabled = index === 0;
    updateNext();
    card.innerHTML = `
      <span class="tag">${index + 1} / ${words.length}</span>
      ${focus.listen ? `<button type="button" class="big-audio" data-speak="${escape(w.hanzi)}"
        data-pinyin="${escape(w.pinyin)}" aria-label="Réécouter (A)">🔊</button>` : ""}
      ${part("hanzi", `<div class="answer-word">
        <span class="big-hanzi">${escape(w.hanzi)}</span>
        ${speakButton(w.hanzi, { pinyin: w.pinyin })}
        <button type="button" class="icon-button" data-strokes title="Ordre des traits (T)"
          aria-label="Ordre des traits">✍</button>
      </div>`)}
      <div class="strokes" id="strokes"></div>
      ${focus.strokes ? `<div class="study-practice">
        <button type="button" class="secondary small-button" data-practice>✍ Je m'entraîne à tracer</button>
        <div class="strokes" id="practice"></div>
        <p class="muted small" id="practice-result"></p>
      </div>` : ""}
      ${part("pinyin", `<div class="pinyin">${escape(w.pinyin)}</div>`)}
      ${part("meaning", `<div class="meaning">${escape(w.translation)}</div>`)}
      ${part("measure", w.measure ? `
        <div class="measure" title="Classificateur">
          <span class="muted small">量词</span>
          <span class="hanzi-sm">${escape(w.measure.hanzi)}</span>
          ${speakButton(w.measure.hanzi)}
          <span class="muted">${escape(w.measure.pinyin)}</span>
          ${w.classifiers.length > 1 ? `<span class="muted small">· aussi
            ${w.classifiers.slice(1).map((c) => escape(c.hanzi)).join("、")}</span>` : ""}
        </div>` : "")}
      ${part("example", w.example ? `
        <div class="example">
          <div>${escape(w.example.hanzi)} ${speakButton(w.example.hanzi, { label: "Écouter la phrase" })}</div>
          <div class="muted">${escape(w.example.pinyin)}</div>
          <div>${escape(w.example.translation)}</div>
        </div>` : "")}`;
    card.querySelector("[data-strokes]").addEventListener("click", showStrokes);
    card.querySelectorAll(".concealed").forEach((p) => p.addEventListener("click", reveal, { once: true }));
    card.querySelector("[data-practice]")?.addEventListener("click", startPractice);
    if (settings.autoplay || focus.listen) speak(w.hanzi, w.pinyin);
    if (focus.strokes) showStrokes();
    schedule();
  }

  // Dévoile les parties cachées ; le défilement passe ensuite au mot suivant.
  function reveal() {
    if (revealed) return;
    revealed = true;
    card.querySelectorAll(".concealed").forEach((p) => p.classList.remove("concealed"));
    updateNext();
    schedule();
  }

  function updateNext() {
    el.querySelector("#next").textContent = !revealed ? "Voir la réponse"
      : index === words.length - 1 ? "Terminer ✓" : "Suivant →";
  }

  function showStrokes() {
    mountStrokes(card.querySelector("#strokes"), words[index].hanzi, 90).animate();
  }

  // Tracé avec le modèle grisé, trait par trait (sans note).
  function startPractice() {
    stop();
    const result = card.querySelector("#practice-result");
    result.textContent = "Trace chaque trait dans l'ordre sur le modèle.";
    practice = mountStrokes(card.querySelector("#practice"), words[index].hanzi, 120, { outline: true });
    practice.quiz((mistakes) => {
      result.textContent = mistakes ? `Terminé avec ${mistakes} erreur(s) : recommence pour t'améliorer.` : "Parfait, aucune erreur !";
    });
  }

  function renderEnd() {
    stop();
    card.innerHTML = `
      <div class="big-hanzi">✓</div>
      <p>Tu as parcouru les ${words.length} mot(s) de l'exercice.</p>
      <div class="actions center-actions">
        <button type="button" class="secondary" id="again">Recommencer</button>
        ${testLink.replace("<a ", '<a class="button" ')}
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

  // Suivant : dévoile d'abord ce qui est caché.
  function advance() {
    if (!revealed) reveal();
    else go(index + 1);
  }

  function go(target) {
    el.querySelector("#next").disabled = false;
    if (!words.length) {
      stop();
      card.innerHTML = `<p>Aucun mot de cet exercice n'a de classificateur : choisis autre chose à travailler.</p>`;
      el.querySelector("#next").disabled = true;
      el.querySelector("#prev").disabled = true;
      return;
    }
    if (target >= words.length) return renderEnd();
    index = Math.max(0, target);
    render();
  }

  // Défilement automatique : un mot toutes les `speed` secondes.
  function schedule() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(advance, settings.speed * 1000);
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
  el.querySelector("#next").addEventListener("click", advance);
  el.querySelector("#focus").addEventListener("change", (e) => {
    settings.focus = e.target.value;
    writeSettings(settings);
    words = focusWords();
    go(0);
  });
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
    words = shuffle(focusWords());
    go(0);
  });

  function onKey(e) {
    if (e.target.matches?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      if (index < words.length) advance();
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
    // Un trait tracé dans la case d'écriture n'est pas un geste pour changer de mot.
    const tracing = e.target.closest?.(".stroke-quiz, .stroke-box");
    touchStart = e.touches.length === 1 && !tracing ? [e.touches[0].clientX, e.touches[0].clientY] : null;
  }, { passive: true });
  card.addEventListener("touchend", (e) => {
    if (!touchStart || index >= words.length) return;
    const dx = e.changedTouches[0].clientX - touchStart[0];
    const dy = e.changedTouches[0].clientY - touchStart[1];
    touchStart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) advance();
    else if (index > 0) go(index - 1);
  });

  document.addEventListener("keydown", onKey);
  go(index);
  return () => {
    clearTimeout(timer);
    practice?.cancel();
    document.removeEventListener("keydown", onKey);
    stopSpeaking();
  };
}
