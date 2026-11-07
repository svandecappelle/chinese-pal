import { api, escape, MODES } from "../api.js";
import { can, session } from "../session.js";

export async function exercisesView(el) {
  const exercises = await api("/exercises");
  const assigned = exercises.filter((ex) => ex.assigned);
  const others = exercises.filter((ex) => !ex.assigned);
  const todoTotal = assigned.reduce((n, ex) => n + ex.stats.due + ex.stats.new_today, 0);

  el.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Exercices</h2>
        <p class="muted small">${todoTotal
          ? `${todoTotal} carte(s) à réviser aujourd'hui`
          : "Tout est à jour pour aujourd'hui 🎉"}</p>
      </div>
      ${can("manage_courses") ? '<a class="button" href="#/exercices/nouveau">+ Nouvel exercice</a>' : ""}
    </div>
    <div class="grid">
      ${assigned.map(card).join("") || `
        <div class="empty">
          ${can("manage_courses")
            ? `<p>Aucun exercice pour l'instant.</p>
               <p><a href="#/vocabulaire">Importe une liste HSK</a> puis crée ton premier exercice.</p>`
            : "<p>Aucun exercice ne t'est encore attribué : ton professeur l'ajoutera à ta classe.</p>"}
        </div>`}
    </div>
    ${others.length ? `
      <h3 class="section-title">Exercices des autres professeurs <small class="muted">(modifiables en tant qu'administrateur)</small></h3>
      <div class="grid">${others.map(card).join("")}</div>` : ""}`;
}

// Pour qui est l'exercice : auteur et destinataires (vu par ceux qui peuvent le modifier).
function audience(ex) {
  if (!ex.can_edit) {
    return ex.owner_username ? `<p class="muted small">Par ${escape(ex.owner_name || ex.owner_username)}</p>` : "";
  }
  const to = ex.everyone ? "tous les comptes"
    : ex.group_ids.length ? `${ex.group_ids.length} groupe(s)` : "toi seul";
  const by = ex.owner_id === session.user.id ? "" : ` · par ${escape(ex.owner_name || ex.owner_username || "?")}`;
  return `<p class="muted small">Pour ${to}${by}</p>`;
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
      ${audience(ex)}
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
        ${!ex.assigned ? ""
          : todo > 0
          ? `<a class="button" href="#/exercices/${ex.id}/reviser">Réviser (${todo})</a>`
          : '<span class="muted">Rien à réviser aujourd\'hui ✓</span>'}
        ${ex.can_edit ? `
          <a class="button secondary" href="#/exercices/${ex.id}/modifier">Modifier</a>
          <a class="button secondary" href="#/exercices/${ex.id}/suivi" title="Progression des élèves">Suivi</a>` : ""}
      </div>
    </article>`;
}
