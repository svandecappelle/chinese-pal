import { api, escape } from "./api.js";
import { exercisesView } from "./views/exercises.js";
import { editorView } from "./views/editor.js";
import { playView } from "./views/play.js";
import { vocabView } from "./views/vocab.js";

// Chaque vue reçoit (élément, paramètres) et peut renvoyer une fonction de nettoyage.
const routes = [
  [/^\/$/, exercisesView, "exercises"],
  [/^\/exercices\/nouveau$/, editorView, "exercises"],
  [/^\/exercices\/(?<id>\d+)\/modifier$/, editorView, "exercises"],
  [/^\/exercices\/(?<id>\d+)\/reviser$/, playView, "exercises"],
  [/^\/vocabulaire$/, vocabView, "vocab"],
];

const view = document.getElementById("view");
let cleanup = null;

async function render() {
  cleanup?.();
  cleanup = null;
  const path = location.hash.slice(1) || "/";
  const route = routes.find(([re]) => re.test(path));
  if (!route) {
    location.hash = "#/";
    return;
  }
  const [re, viewFn, nav] = route;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === nav);
  });
  view.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    cleanup = (await viewFn(view, path.match(re).groups ?? {})) ?? null;
  } catch (err) {
    view.innerHTML = `<p class="error">Erreur : ${escape(err.message)}</p>`;
  }
}

async function checkHealth() {
  const el = document.getElementById("status");
  try {
    await api("/health");
    el.textContent = "● base connectée";
    el.className = "status ok";
  } catch {
    el.textContent = "● base injoignable";
    el.className = "status ko";
  }
}

window.addEventListener("hashchange", render);
render();
checkHealth();
