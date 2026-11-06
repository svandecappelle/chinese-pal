// Briques d'interface communes : notifications, pagination, mémorisation des réglages d'affichage.

let toastRegion = null;

/** Petite notification temporaire en bas de l'écran. type : info | success | error. */
export function toast(message, type = "info") {
  if (!toastRegion) {
    toastRegion = document.createElement("div");
    toastRegion.className = "toasts";
    toastRegion.setAttribute("role", "status");
    toastRegion.setAttribute("aria-live", "polite");
    document.body.append(toastRegion);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  toastRegion.append(item);
  setTimeout(() => item.classList.add("leaving"), type === "error" ? 6000 : 3000);
  setTimeout(() => item.remove(), type === "error" ? 6400 : 3400);
}

/** Réglages d'affichage gardés pendant la session de navigation (filtre, page, tri…). */
export function remember(key, defaults) {
  try {
    return { ...defaults, ...JSON.parse(sessionStorage.getItem(key) ?? "{}") };
  } catch {
    return { ...defaults };
  }
}

export function save(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible : les réglages ne seront pas mémorisés.
  }
}

export const PAGE_SIZES = [10, 25, 50, 100];

/** Découpe `items` selon `state` ({ page, size }) ; corrige la page si elle déborde. */
export function paginate(items, state) {
  const pages = Math.max(1, Math.ceil(items.length / state.size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.size;
  return { items: items.slice(start, start + state.size), pages, start, total: items.length };
}

/** Barre de pagination ; les clics sont gérés par `bindPager`. */
export function pagerHtml(result, state, unit = "élément(s)") {
  if (result.total === 0) return "";
  const { pages, start, items, total } = result;
  const first = state.page === 1;
  const last = state.page === pages;
  return `
    <nav class="pager" aria-label="Pagination">
      <div class="pager-buttons">
        <button type="button" class="secondary" data-page="1" ${first ? "disabled" : ""} aria-label="Première page">«</button>
        <button type="button" class="secondary" data-page="${state.page - 1}" ${first ? "disabled" : ""} aria-label="Page précédente">‹</button>
        <span class="pager-info">Page ${state.page} / ${pages}</span>
        <button type="button" class="secondary" data-page="${state.page + 1}" ${last ? "disabled" : ""} aria-label="Page suivante">›</button>
        <button type="button" class="secondary" data-page="${pages}" ${last ? "disabled" : ""} aria-label="Dernière page">»</button>
      </div>
      <span class="muted">${start + 1}–${start + items.length} sur ${total} ${unit}</span>
      <label class="pager-size">
        <select data-page-size aria-label="Éléments par page">
          ${PAGE_SIZES.map((n) => `<option value="${n}" ${n === state.size ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        par page
      </label>
    </nav>`;
}

export function bindPager(container, state, rerender) {
  container.addEventListener("click", (e) => {
    const button = e.target.closest("[data-page]");
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    rerender();
  });
  container.addEventListener("change", (e) => {
    if (!e.target.matches("[data-page-size]")) return;
    state.size = Number(e.target.value);
    state.page = 1;
    rerender();
  });
}

/** Désactive un bouton pendant une action asynchrone, avec un libellé d'attente. */
export async function withBusy(button, label, action) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}
