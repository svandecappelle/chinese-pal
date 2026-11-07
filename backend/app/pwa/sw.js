// Service worker : l'application s'ouvre et se révise sans réseau.
// Servi par main.py (/sw.js), qui y inscrit la version et la liste du frontend : chaque mise à jour du
// frontend change la version, le nouveau service worker remet alors tout le frontend en cache.
//
// - frontend (HTML, CSS, JS, icônes, Hanzi Writer) : en cache dès l'installation ;
// - tracés des caractères et prononciations : gardés en cache dès qu'ils ont servi une fois ;
// - API (exercices, sessions, mots…) : réseau d'abord, dernière réponse en cache si hors ligne.
//   Les réponses envoyées hors ligne attendent dans le navigateur (voir api.js).

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const SHELL = `chinese-shell-${VERSION}`;
const DATA = "chinese-data";
const API = "chinese-api";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("chinese-shell-") && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Données qui ne changent pas (tracé d'un caractère, audio d'un mot) : le cache d'abord.
async function cacheFirst(request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // 200 seulement : un morceau d'audio (206, requête « Range ») ne se met pas en cache.
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}

// API : le réseau d'abord ; sans réseau, la dernière réponse connue.
async function networkFirst(request) {
  const cache = await caches.open(API);
  try {
    const response = await fetch(request);
    if (response.status === 200) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ detail: "Hors ligne : cette page n'a pas encore été ouverte avec le réseau" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Frontend : la version en cache (installée avec ce service worker), sinon le réseau.
async function shell(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode === "navigate") return caches.match("./");
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path === "/api/health") return; // toujours le réseau (indicateur de connexion)
  if (path.startsWith("/strokes/") || path.startsWith("/api/tts")) {
    event.respondWith(cacheFirst(request));
  } else if (path.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(shell(request));
  }
});
