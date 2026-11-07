// Claviers à l'écran, ancrés en bas de la fenêtre :
// - « pinyin » : tons et voyelles accentuées (et chiffres de ton convertis à la frappe) ;
// - « hanzi » : méthode de saisie, on tape le pinyin et on choisit les caractères.
// `attachKeyboard(input, kind)` ajoute à côté du champ le bouton qui ouvre le clavier.

import { api, escape } from "./api.js";
import { numbersToMarks, toneLastSyllable } from "./pinyin.js";

const TONES = [
  [1, "ā", "1er ton"],
  [2, "á", "2e ton"],
  [3, "ǎ", "3e ton"],
  [4, "à", "4e ton"],
  [0, "a", "Ton neutre"],
];
const VOWELS = ["āáǎà", "ēéěè", "īíǐì", "ōóǒò", "ūúǔù", "ǖǘǚǜü"];
const PUNCTUATION = { ",": "，", ".": "。", "?": "？", "!": "！", ":": "：", ";": "；" };
const PAGE_SIZE = 9;
const TOGGLES = {
  pinyin: ["ǎ", "Clavier pinyin (tons)"],
  hanzi: ["汉", "Clavier chinois (caractères par le pinyin)"],
};

let panel = null;
let target = null;
let kind = null;
// Saisie en cours du clavier hanzi.
let candidates = [];
let page = 0;
let request = 0;
// Recherche en cours, et choix tapés en attente : chaque choix attend la recherche qui le précède.
let searching = Promise.resolve();
let choices = Promise.resolve();
let pendingChoices = 0;

const isOpen = () => panel !== null && !panel.hidden;

export function attachKeyboard(input, keyboardKind) {
  const field = document.createElement("span");
  field.className = "kb-field";
  input.replaceWith(field);
  const [label, title] = TOGGLES[keyboardKind];
  field.innerHTML = `<button type="button" class="kb-toggle" title="${title}" aria-label="${title}">${label}</button>`;
  field.prepend(input);

  const toggle = field.querySelector(".kb-toggle");
  toggle.addEventListener("mousedown", (e) => e.preventDefault());
  toggle.addEventListener("click", () => {
    if (isOpen() && target === input) close();
    else open(input, keyboardKind, { focusBuffer: true });
  });
  input.addEventListener("focus", () => {
    if (isOpen() && target !== input) open(input, keyboardKind);
  });
  input.addEventListener("keydown", (e) => onTargetKey(e, input));
}

function open(input, keyboardKind, { focusBuffer = false } = {}) {
  target = input;
  kind = keyboardKind;
  panel ??= createPanel();
  // Dans une boîte de dialogue modale, le reste de la page est inactif : le clavier va dedans.
  const host = input.closest("dialog[open]") ?? document.body;
  if (panel.parentElement !== host) {
    host.append(panel);
    if (host !== document.body) host.addEventListener("close", close, { once: true });
  }
  panel.hidden = false;
  render();
  document.body.classList.add("kb-open");
  document.documentElement.style.setProperty("--kb-height", `${panel.offsetHeight + 16}px`);
  revealTarget();
  updateToggles();
  if (kind === "hanzi" && focusBuffer) panel.querySelector(".kb-buffer").focus();
  else input.focus();
}

/** Ramène le champ dans la partie visible, entre l'en-tête collant et le clavier. */
function revealTarget() {
  const field = target.getBoundingClientRect();
  const top = target.closest("dialog") ? 0 : (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
  if (field.top < top || field.bottom > panel.getBoundingClientRect().top) {
    target.scrollIntoView({ block: "center" });
  }
}

export function close() {
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("kb-open");
  updateToggles();
}

function updateToggles() {
  document.querySelectorAll(".kb-field").forEach((field) => {
    const active = isOpen() && field.contains(target);
    field.querySelector(".kb-toggle").classList.toggle("active", active);
  });
}

function createPanel() {
  const element = document.createElement("div");
  element.className = "keyboard";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Clavier chinois");
  // Les boutons ne prennent pas le focus : le curseur reste dans le champ.
  element.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  element.addEventListener("click", onPanelClick);
  element.addEventListener("input", (e) => {
    if (e.target.matches(".kb-buffer")) onBufferInput(e.target);
  });
  element.addEventListener("keydown", (e) => {
    if (e.target.matches(".kb-buffer")) onBufferKey(e, e.target);
  });
  window.addEventListener("hashchange", close);
  return element;
}

function render() {
  const head = (title) => `
    <div class="kb-head">
      ${title}
      <button type="button" class="icon-button" data-close title="Fermer (Échap)" aria-label="Fermer le clavier">✕</button>
    </div>`;
  if (kind === "pinyin") {
    panel.innerHTML = `
      ${head('<strong>Pinyin</strong><span class="muted small">Tape la syllabe puis son ton, ou un chiffre : ni3 → nǐ</span>')}
      <div class="kb-tones">
        ${TONES.map(([tone, mark, label]) => `
          <button type="button" class="secondary" data-tone="${tone}" title="${label}">${mark}<kbd>${tone || 5}</kbd></button>`).join("")}
      </div>
      <div class="kb-vowels">
        ${VOWELS.map((row) => [...row].map((v) => `
          <button type="button" class="secondary" data-insert="${v}">${v}</button>`).join("")).join("")}
      </div>`;
  } else {
    candidates = [];
    page = 0;
    panel.innerHTML = `
      ${head(`<input class="kb-buffer" placeholder="Tape le pinyin, ex. nihao" aria-label="Pinyin à convertir"
        autocomplete="off" autocapitalize="off" spellcheck="false">`)}
      <div class="kb-candidates" aria-live="polite"></div>
      <div class="kb-nav">
        <button type="button" class="secondary" data-page="-1" aria-label="Candidats précédents">‹</button>
        <button type="button" class="secondary" data-page="1" aria-label="Candidats suivants">›</button>
        <span class="muted small hide-narrow"><kbd>Espace</kbd> ou <kbd>1</kbd>–<kbd>9</kbd> choisir ·
          <kbd>-</kbd> <kbd>=</kbd> page · <kbd>Entrée</kbd> lettres · <kbd>Échap</kbd> fermer</span>
      </div>`;
    renderCandidates();
  }
}

function onPanelClick(e) {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.matches("[data-close]")) {
    close();
    target?.focus();
  } else if (button.dataset.tone !== undefined) {
    applyTone(Number(button.dataset.tone));
  } else if (button.dataset.insert) {
    insert(button.dataset.insert);
  } else if (button.dataset.pick !== undefined) {
    pick(candidates[Number(button.dataset.pick)]);
  } else if (button.dataset.page) {
    turnPage(Number(button.dataset.page));
  }
}

/** Remplace la sélection du champ cible par `text`, même si le focus est dans le clavier. */
function insert(text) {
  if (!target?.isConnected) return;
  target.setRangeText(text, target.selectionStart, target.selectionEnd, "end");
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function deleteBackward() {
  const { selectionStart: start, selectionEnd: end } = target;
  if (start === end && start > 0) target.setRangeText("", start - 1, end, "end");
  else target.setRangeText("", start, end, "end");
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyTone(tone) {
  const end = target.selectionStart;
  const before = target.value.slice(0, end);
  target.setRangeText(toneLastSyllable(before, tone), 0, end, "end");
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function onTargetKey(e, input) {
  if (!isOpen() || target !== input || e.ctrlKey || e.metaKey || e.altKey) return;
  if (kind === "pinyin" && /^[0-5]$/.test(e.key)) {
    // Chiffre juste après une lettre : c'est un ton.
    if (/[a-zA-ZÀ-ɏ]$/.test(input.value.slice(0, input.selectionStart))) {
      e.preventDefault();
      applyTone(e.key === "5" ? 0 : Number(e.key));
    }
  } else if (kind === "hanzi" && /^[a-zA-Z]$/.test(e.key)) {
    // Les lettres partent dans la zone de pinyin du clavier.
    e.preventDefault();
    panel.querySelector(".kb-buffer").focus();
    typeLetter(e.key.toLowerCase());
  } else if (e.key === "Escape") {
    close();
  }
}

const lettersOf = (text) => text.toLowerCase().replace(/ü/g, "v").replace(/[^a-z]/g, "");

function onBufferInput(buffer) {
  // Claviers virtuels (mobile) : l'espace ou un chiffre arrive dans le champ, pas en touche.
  const choice = buffer.value.match(/([ 1-9])$/)?.[1];
  if (choice && candidates.length) {
    buffer.value = buffer.value.slice(0, -1);
    const index = choice === " " ? 0 : Number(choice) - 1;
    pick(candidates[page * PAGE_SIZE + index]);
    return;
  }
  const letters = lettersOf(buffer.value);
  if (buffer.value !== letters) buffer.value = letters;
  search(letters);
}

function search(letters) {
  searching = fetchCandidates(letters);
  return searching;
}

async function fetchCandidates(letters) {
  const current = ++request;
  if (!letters) {
    candidates = [];
    renderCandidates();
    return;
  }
  try {
    const result = await api(`/ime?q=${encodeURIComponent(letters)}`);
    if (current !== request) return;
    candidates = result.candidates;
  } catch {
    if (current !== request) return;
    candidates = [];
  }
  page = 0;
  renderCandidates();
}

function renderCandidates() {
  const list = panel.querySelector(".kb-candidates");
  if (!list) return;
  const buffer = panel.querySelector(".kb-buffer");
  const shown = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  list.innerHTML = shown.length
    ? shown.map((c, i) => `
        <button type="button" class="kb-candidate" data-pick="${page * PAGE_SIZE + i}">
          <kbd>${i + 1}</kbd><span class="kb-hanzi">${escape(c.hanzi)}</span>
          <small>${escape(numbersToMarks(c.pinyin))}</small>
        </button>`).join("")
    : `<span class="muted small">${buffer?.value ? "Aucun caractère pour ce pinyin" : "Les caractères proposés apparaîtront ici"}</span>`;
  panel.querySelector('[data-page="-1"]').disabled = page === 0;
  panel.querySelector('[data-page="1"]').disabled = (page + 1) * PAGE_SIZE >= candidates.length;
}

function turnPage(step) {
  const last = Math.max(0, Math.ceil(candidates.length / PAGE_SIZE) - 1);
  page = Math.min(last, Math.max(0, page + step));
  renderCandidates();
}

function pick(candidate) {
  if (!candidate) return;
  insert(candidate.hanzi);
  const buffer = panel.querySelector(".kb-buffer");
  // Le pinyin non couvert par le candidat reste à convertir (nihaoma → 你好 puis « ma »).
  buffer.value = lettersOf(buffer.value).slice(candidate.consumed);
  buffer.focus();
  search(buffer.value);
}

// Frappe rapide : un choix (Espace, chiffre) attend la réponse à la recherche qui le précède, et
// les lettres tapées entre-temps attendent ce choix, pour respecter l'ordre de frappe.
function enqueue(step) {
  pendingChoices++;
  choices = choices
    .then(() => searching)
    .then(step)
    .catch(() => {})
    .finally(() => pendingChoices--);
}

/** Choisit le n-ième candidat de la page ; `orElse` si rien n'est en cours de saisie. */
function choose(index, { then = () => {}, orElse = () => {} } = {}) {
  enqueue(() => {
    if (panel.querySelector(".kb-buffer").value) {
      pick(candidates[page * PAGE_SIZE + index]);
      then();
    } else {
      orElse();
    }
  });
}

function typeLetter(letter) {
  const buffer = panel.querySelector(".kb-buffer");
  const type = () => {
    buffer.value += letter;
    onBufferInput(buffer);
  };
  if (pendingChoices) enqueue(type);
  else type();
}

function onBufferKey(e, buffer) {
  const hasText = buffer.value !== "" || pendingChoices > 0;
  if (/^[a-zA-Z]$/.test(e.key) && pendingChoices && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    typeLetter(e.key.toLowerCase());
  } else if (e.key === " ") {
    e.preventDefault();
    choose(0, { orElse: () => insert(" ") });
  } else if (/^[1-9]$/.test(e.key)) {
    e.preventDefault();
    choose(Number(e.key) - 1);
  } else if (e.key === "-" || e.key === "PageUp") {
    e.preventDefault();
    turnPage(-1);
  } else if (e.key === "=" || e.key === "PageDown") {
    e.preventDefault();
    turnPage(1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (hasText) {
      insert(buffer.value);
      buffer.value = "";
      search("");
    } else {
      target.focus();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (hasText) {
      buffer.value = "";
      search("");
    } else {
      close();
      target.focus();
    }
  } else if (e.key === "Backspace" && !hasText) {
    e.preventDefault();
    deleteBackward();
  } else if (PUNCTUATION[e.key]) {
    e.preventDefault();
    const mark = PUNCTUATION[e.key];
    choose(0, { then: () => insert(mark), orElse: () => insert(mark) });
  }
}
