import { api, escape } from "./api.js";
import { flushReviews, pendingCount } from "./offline.js";
import { toast } from "./ui.js";
import { can, displayName, loadSession, session, setUser } from "./session.js";
import { accountView } from "./views/account.js";
import { adminView } from "./views/admin.js";
import { exercisesView } from "./views/exercises.js";
import { feedView } from "./views/feed.js";
import { editorView } from "./views/editor.js";
import { loginView } from "./views/login.js";
import { playView } from "./views/play.js";
import { progressView } from "./views/progress.js";
import { readingView } from "./views/reading.js";
import { statsView } from "./views/stats.js";
import { studyView } from "./views/study.js";
import { vocabView } from "./views/vocab.js";
import { writingView } from "./views/writing.js";

// [chemin, vue, onglet actif, accès]. Accès : null (libre), "user" (connecté) ou un droit.
// Chaque vue reçoit (élément, paramètres) et peut renvoyer une fonction de nettoyage. Les
// paramètres d'adresse (#/chemin?a=1) arrivent dans `query` (URLSearchParams).
const routes = [
  [/^\/$/, exercisesView, "exercises", null],
  // Fil de révision : les petits pas du jour et ce qui a été fait.
  [/^\/fil$/, feedView, "feed", "user"],
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
  // Statistiques personnelles (compte ou invité) et révision des mots les plus ratés.
  [/^\/statistiques$/, statsView, "stats", null],
  [/^\/lecture$/, readingView, "reading", null],
  [/^\/statistiques\/reviser$/, studyView, "stats", null],
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
  document.querySelector("[data-nav=stats]").hidden = !user && !session.guest;
  document.querySelector("[data-nav=feed]").hidden = !user;
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
  const [path, search = ""] = (location.hash.slice(1) || "/").split("?");
  const route = routes.find(([re]) => re.test(path));
  if (!route) {
    location.hash = "#/";
    return;
  }
  const [re, viewFn, nav, access] = route;

  if (access && !session.user) {
    // Après connexion, retour à la page demandée.
    sessionStorage.setItem("chinese.next", location.hash.slice(1) || "/");
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
    const params = { ...(path.match(re).groups ?? {}), query: new URLSearchParams(search) };
    cleanup = (await viewFn(view, params)) ?? null;
  } catch (err) {
    view.innerHTML = `<p class="error">Erreur : ${escape(err.message)}</p>`;
  }
}

// Indicateur de connexion, avec les réponses qui attendent le réseau.
async function checkHealth() {
  const el = document.getElementById("status");
  const pending = pendingCount();
  const waiting = pending ? ` · ${pending} réponse${pending > 1 ? "s" : ""} en attente` : "";
  if (!navigator.onLine) {
    el.textContent = `● hors ligne${waiting}`;
    el.title = "Les exercices déjà ouverts restent disponibles ; les réponses seront envoyées au retour du réseau.";
    el.className = "status offline";
    return;
  }
  try {
    await api("/health");
    el.textContent = `●${waiting}`;
    el.title = "Base connectée";
    el.className = "status ok";
  } catch {
    el.textContent = `● serveur injoignable${waiting}`;
    el.title = "Les exercices déjà ouverts restent disponibles hors ligne.";
    el.className = "status ko";
  }
}

// Réponses données hors ligne : envoyées dès que possible.
async function sync() {
  if (!pendingCount() || !navigator.onLine) return checkHealth();
  const sent = await flushReviews();
  if (sent) toast(`${sent} réponse${sent > 1 ? "s" : ""} donnée${sent > 1 ? "s" : ""} hors ligne envoyée${sent > 1 ? "s" : ""}.`);
  checkHealth();
}

window.addEventListener("online", sync);
// Serveur injoignable alors que le téléphone a du réseau (pas d'événement « online ») : on réessaie.
setInterval(() => pendingCount() && sync(), 30000);
window.addEventListener("offline", checkHealth);
window.addEventListener("pending-reviews", checkHealth);

// Sur un téléphone Android, hors de l'application : bandeau pour télécharger l'APK (make apk),
// s'il y en a un. Fermé, il ne revient qu'avec une nouvelle version.
const ANDROID_BANNER_KEY = "chinese.androidBanner";

async function offerAndroidApp() {
  const inApp = document.referrer.startsWith("android-app://") || sessionStorage.getItem("chinese.inApp");
  if (inApp) sessionStorage.setItem("chinese.inApp", "1");
  if (!/Android/i.test(navigator.userAgent) || inApp || matchMedia("(display-mode: standalone)").matches) return;
  let info;
  try {
    const res = await fetch("android/info.json", { cache: "no-store" });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    return;
  }
  try {
    if (localStorage.getItem(ANDROID_BANNER_KEY) === info.version) return;
  } catch {
    // Stockage indisponible : le bandeau s'affiche.
  }
  const banner = document.createElement("div");
  banner.className = "app-banner";
  banner.innerHTML = `
    <span>📱 <strong>Application Android</strong> · ${Math.max(1, Math.round(info.size / 1024))} Ko
      <small>Android peut demander d'autoriser l'installation depuis ce site.</small></span>
    <a class="button small-button" href="android/${escape(info.file)}" download>Télécharger</a>
    <button type="button" class="icon-button" aria-label="Fermer">✕</button>`;
  banner.querySelector("button").addEventListener("click", () => {
    banner.remove();
    try {
      localStorage.setItem(ANDROID_BANNER_KEY, info.version);
    } catch {
      // Le bandeau reviendra au prochain chargement.
    }
  });
  document.querySelector("header").after(banner);
}

// Application installable et utilisable hors ligne (voir app/pwa/sw.js).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
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
sync();
offerAndroidApp();
