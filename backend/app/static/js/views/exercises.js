import { api, escape, MODES } from "../api.js";

export async function exercisesView(el) {
  const exercises = await api("/exercises");
  const todoTotal = exercises.reduce((n, ex) => n + ex.stats.due + ex.stats.new_today, 0);

  el.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Exercices</h2>
        <p class="muted small">${todoTotal
          ? `${todoTotal} carte(s) à réviser aujourd'hui`
          : "Tout est à jour pour aujourd'hui 🎉"}</p>
      </div>
      <a class="button" href="#/exercices/nouveau">+ Nouvel exercice</a>
    </div>
    <div class="grid">
      ${exercises.map(card).join("") || `
        <div class="empty">
          <p>Aucun exercice pour l'instant.</p>
          <p><a href="#/vocabulaire">Importe une liste HSK</a> puis crée ton premier exercice.</p>
        </div>`}
    </div>`;
}

function card(ex) {
  const { total, unseen, due, new_today } = ex.stats;
  const todo = due + new_today;
  const seen = total - unseen;
  const percent = total ? Math.round((seen / total) * 100) : 0;
  return `
    <article class="exercise">
      <h3>${escape(ex.name)}</h3>
      ${ex.description ? `<p class="muted small">${escape(ex.description)}</p>` : ""}
      <p class="tags">
        ${ex.modes.map((m) => `<span class="tag">${MODES[m].label}</span>`).join("")}
      </p>
      <div class="progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"
        aria-label="Cartes déjà vues">
        <div class="progress-bar" style="width: ${percent}%"></div>
      </div>
      <p class="muted small">${seen} / ${total} cartes déjà vues (${percent} %)</p>
      <p class="counts">
        <span class="due">${due} à revoir</span>
        <span class="new">${new_today} nouvelles</span>
      </p>
      <div class="actions">
        ${todo > 0
          ? `<a class="button" href="#/exercices/${ex.id}/reviser">Réviser (${todo})</a>`
          : '<span class="muted">Rien à réviser aujourd\'hui ✓</span>'}
        <a class="button secondary" href="#/exercices/${ex.id}/modifier">Modifier</a>
      </div>
    </article>`;
}
