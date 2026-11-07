import { api, escape } from "../api.js";
import { displayName } from "../session.js";

const date = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—";

// Suivi d'un exercice par son auteur : où en est chaque élève à qui il est attribué.
export async function progressView(el, { id }) {
  const { exercise, students } = await api(`/exercises/${id}/progress`);
  const rows = students.map((s) => {
    const { total, unseen, due } = s.stats;
    const seen = total - unseen;
    return { ...s, seen, total, due, percent: total ? Math.round((seen / total) * 100) : 0 };
  });

  el.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Suivi · ${escape(exercise.name)}</h2>
        <p class="muted small">${exercise.everyone ? "Attribué à tous les comptes" : "Élèves des groupes attribués"}
          · ${rows.length} élève(s)</p>
      </div>
      <div class="actions">
        <a class="button secondary" href="#/exercices/${id}/modifier">Modifier</a>
        <a href="#/" class="muted">← Retour</a>
      </div>
    </div>
    ${rows.length ? `
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Élève</th><th>Cartes vues</th><th>À revoir</th><th class="hide-narrow">Dernière révision</th>
          </tr></thead>
          <tbody>
            ${rows.map((s) => `
              <tr>
                <td><strong>${escape(displayName(s))}</strong>
                  ${s.display_name ? `<div class="muted small">${escape(s.username)}</div>` : ""}</td>
                <td>
                  <div class="progress" aria-hidden="true"><div class="progress-bar" style="width: ${s.percent}%"></div></div>
                  <span class="small">${s.seen} / ${s.total} (${s.percent} %)</span>
                </td>
                <td class="${s.due ? "due" : "muted"}">${s.due}</td>
                <td class="hide-narrow muted small">${date(s.last_review)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty">
        <p>Personne ne révise encore cet exercice.</p>
        <p><a href="#/exercices/${id}/modifier">Attribue-le à un groupe</a> pour suivre ses élèves.</p>
      </div>`}`;
}
