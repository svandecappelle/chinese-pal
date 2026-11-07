import { api, escape } from "./api.js";
import { can, displayName, loadSession, session, setUser } from "./session.js";
import { accountView } from "./views/account.js";
import { adminView } from "./views/admin.js";
import { exercisesView } from "./views/exercises.js";
import { editorView } from "./views/editor.js";
import { loginView } from "./views/login.js";
import { playView } from "./views/play.js";
import { progressView } from "./views/progress.js";
import { studyView } from "./views/study.js";
import { vocabView } from "./views/vocab.js";
import { writingView } from "./views/writing.js";

// [chemin, vue, onglet actif, accès]. Accès : null (libre), "user" (connecté) ou un droit.
// Chaque vue reçoit (élément, paramètres) et peut renvoyer une fonction de nettoyage.
const routes = [
  [/^\/$/, exercisesView, "exercises", null],
  [/^\/connexion$/, loginView, "", null],
  [/^\/compte$/, accountView, "account", "user"],
  [/^\/administration$/, adminView, "admin", "manage_users"],
  [/^\/exercices\/nouveau$/, editorView, "exercises", "manage_courses"],
  [/^\/exercices\/(?<id>\d+)\/modifier$/, editorView, "exercises", "manage_courses"],
  [/^\/exercices\/(?<id>\d+)\/suivi$/, progressView, "exercises", "manage_courses"],
  // Deux façons de lancer un exercice : révision (tout est montré) et test (réponse attendue).
  [/^\/exercices\/(?<id>\d+)\/reviser$/, studyView, "exercises", null],
  [/^\/exercices\/(?<id>\d+)\/test$/, playView, "exercises", null],
  [/^\/vocabulaire$/, vocabView, "vocab", null],
  // Fiches d'écriture à imprimer : caractères au choix, ou les mots d'un exercice ou d'une liste.
  [/^\/fiches$/, writingView, "writing", null],
  [/^\/exercices\/(?<id>\d+)\/fiches$/, writingView, "writing", null],
  [/^\/listes\/(?<deck>\d+)\/fiches$/, writingView, "writing", null],
];

const view = document.getElementById("view");
let cleanup = null;

function renderHeader() {
  const user = session.user;
  document.querySelector("[data-nav=admin]").hidden = !can("manage_users");
  document.getElementById("account").innerHTML = user
    ? `<a href="#/compte" data-nav="account" class="account-link" title="Mon compte">
         <span class="avatar" aria-hidden="true">${escape(displayName(user).slice(0, 1).toUpperCase())}</span>
         <span class="account-name">${escape(displayName(user))}</span>
       </a>
       <button type="button" class="link" id="logout">Déconnexion</button>`
    : '<a href="#/connexion" class="button secondary small-button">Se connecter</a>';
  document.getElementById("logout")?.addEventListener("click", async () => {
    await api("/account/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    location.hash = "#/vocabulaire";
  });
}

async function render() {
  cleanup?.();
  cleanup = null;
  const path = location.hash.slice(1) || "/";
  const route = routes.find(([re]) => re.test(path));
  if (!route) {
    location.hash = "#/";
    return;
  }
  const [re, viewFn, nav, access] = route;

  if (access && !session.user) {
    // Après connexion, retour à la page demandée.
    sessionStorage.setItem("chinese.next", path);
    location.hash = "#/connexion";
    return;
  }
  if (access && access !== "user" && !can(access)) {
    view.innerHTML = `<div class="empty"><p>Cette page demande un droit que ton compte n'a pas.</p>
      <p><a href="#/">Retour à l'accueil</a></p></div>`;
    return;
  }

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
    el.textContent = "●";
    el.title = "Base connectée";
    el.className = "status ok";
  } catch {
    el.textContent = "● base injoignable";
    el.title = "";
    el.className = "status ko";
  }
}

window.addEventListener("session-change", () => {
  renderHeader();
});
window.addEventListener("session-expired", () => {
  if (!session.user) return;
  setUser(null);
  render();
});
window.addEventListener("hashchange", render);

try {
  await loadSession();
} catch {
  // Serveur injoignable : checkHealth l'affiche, les vues montreront l'erreur.
}
renderHeader();
render();
checkHealth();
