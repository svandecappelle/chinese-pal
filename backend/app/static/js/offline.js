// Hors ligne : les réponses d'un test sont gardées dans le navigateur, puis envoyées dès que le
// réseau revient (au retour en ligne, ou au prochain lancement de l'application).
// La carte est reprogrammée au moment de l'envoi, pas au moment de la réponse.

const QUEUE_KEY = "chinese.pendingReviews";

function read() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function write(queue) {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Stockage indisponible : la réponse est perdue.
  }
  window.dispatchEvent(new CustomEvent("pending-reviews", { detail: queue.length }));
}

export const pendingCount = () => read().length;

export function queueReview(review) {
  const queue = read();
  queue.push({ ...review, answered_at: new Date().toISOString() });
  write(queue);
}

let flushing = null;

/** Envoie les réponses en attente, dans l'ordre. Renvoie le nombre envoyé. */
export function flushReviews() {
  flushing ??= (async () => {
    let sent = 0;
    try {
      let queue = read();
      while (queue.length) {
        const { answered_at: _, ...review } = queue[0];
        let res;
        try {
          res = await fetch("/api/reviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(review),
          });
        } catch {
          break; // toujours hors ligne : on réessaiera
        }
        if (res.status >= 500) break;
        // Envoyée (ou refusée pour de bon, 4xx) : elle quitte la file.
        if (res.ok) sent += 1;
        queue = read().slice(1);
        write(queue);
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}

// Le réseau a-t-il manqué ? (fetch rejeté, ou réponse 503 du service worker hors ligne)
export const isNetworkError = (err) => err instanceof TypeError;

/** Vide le cache des réponses de l'API (changement de compte : rien ne doit rester). */
export async function clearApiCache() {
  try {
    await caches?.delete("chinese-api");
  } catch {
    // Pas de cache (navigateur sans service worker).
  }
}
