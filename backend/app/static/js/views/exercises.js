import { api, escape, MODES } from "../api.js";
import { offlineSupported, prepareExercise, preparedExercises } from "../offline-prep.js";
import { can, session } from "../session.js";
import { toast } from "../ui.js";

// Page Exercices : les exercices de l'élève en cartes, rangées à son goût (poignée ⠿ : glisser à
// la souris ou au doigt, ou flèches du clavier ; ordre gardé sur son compte). Sur grand écran, la
// grille prend la largeur disponible.

const MAX_TAGS = 3;
const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;

export async function exercisesView(el) {
  const exercises = await api("/exercises");
  const assigned = exercises.filter((ex) => ex.assigned);
  const others = exercises.filter((ex) => !ex.assigned);
  const todo = (ex) => (ex.assigned ? ex.stats.due + ex.stats.new_today : 0);
  const todoTotal = assigned.reduce((n, ex) => n + todo(ex), 0);
  const waiting = assigned.filter((ex) => todo(ex) > 0).length;
  const anonymous = !session.user;
  // Ranger demande un compte (ou une progression d'invité) : l'ordre est gardé côté serveur.
  const sortable = Boolean(session.user || session.guest) && exercises.length > 1;
  const ctx = { prep: { supported: offlineSupported(), ready: preparedExercises() }, sortable };

  el.innerHTML = `
    <div class="ex-page">
      <div class="toolbar ex-head">
        <div>
          <h2>Exercices</h2>
          <p class="muted small">${!assigned.length ? ""
            : todoTotal ? `<strong class="ex-todo-total">${plural(todoTotal, "carte")} à tester aujourd'hui</strong>
                · ${plural(waiting, "exercice")} sur ${assigned.length}`
            : "Tout est à jour pour aujourd'hui 🎉"}</p>
        </div>
        <div class="actions">
          ${sortable ? '<span class="muted small ex-sort-hint">⠿ Glisse une carte pour la ranger</span>' : ""}
          ${can("manage_courses") ? '<a class="button secondary" href="#/invitations">Inviter des élèves</a>' : ""}
          ${can("manage_courses") ? '<a class="button" href="#/exercices/nouveau">+ Nouvel exercice</a>' : ""}
        </div>
      </div>
      ${anonymous && assigned.length ? `
        <p class="notice small">Exercices publics : révise sans compte.
          ${session.guest ? "Ta progression est gardée dans ce navigateur ; " : "Ta progression sera gardée dans ce navigateur ; "}
          <a href="#/connexion">connecte-toi</a> pour la retrouver sur tous tes appareils.</p>` : ""}
      ${assigned.length ? `<div class="ex-grid" data-sortable>${assigned.map((ex) => card(ex, ctx)).join("")}</div>` : `
        <div class="empty">
          ${anonymous
            ? `<p>Aucun exercice public pour l'instant.</p>
               <p><a href="#/connexion">Connecte-toi</a> pour réviser les exercices de ta classe,
                 ou <a href="#/vocabulaire">parcours le vocabulaire</a>.</p>`
            : can("manage_courses")
            ? `<p>Aucun exercice pour l'instant.</p>
               <p><a href="#/vocabulaire">Importe une liste prête</a> puis crée ton premier exercice.</p>`
            : "<p>Aucun exercice ne t'est encore attribué : ton professeur l'ajoutera à ta classe.</p>"}
        </div>`}
      ${others.length ? `
        <h3 class="section-title">Exercices des autres professeurs <small class="muted">(modifiables en tant qu'administrateur)</small></h3>
        <div class="ex-grid" data-sortable>${others.map((ex) => card(ex, ctx)).join("")}</div>` : ""}
    </div>`;
  bindOfflinePrep(el);
  bindTags(el);
  if (sortable) el.querySelectorAll("[data-sortable]").forEach((grid) => enableReorder(grid, () => saveOrder(el)));
}

// Pour qui est l'exercice : auteur et destinataires (vu par ceux qui peuvent le modifier).
function audience(ex) {
  if (ex.personal) return 'Ta liste personnelle · <a href="#/mes-mots">gérer Mes mots</a>';
  if (!ex.can_edit) return ex.owner_username ? `Par ${escape(ex.owner_name || ex.owner_username)}` : "";
  const to = [
    ex.public && "tout le monde, sans compte",
    ex.everyone ? "tous les comptes" : ex.group_ids.length && plural(ex.group_ids.length, "groupe"),
  ].filter(Boolean).join(" · ") || "toi seul";
  const by = ex.owner_id === session.user.id ? "" : ` · par ${escape(ex.owner_name || ex.owner_username || "?")}`;
  return `Pour ${to}${by}`;
}

function modeTags(ex) {
  const tags = ex.modes.filter((m) => MODES[m]).map((m) => `<span class="tag">${MODES[m].label}</span>`);
  if (tags.length <= MAX_TAGS) return `<p class="tags">${tags.join("")}</p>`;
  const hidden = ex.modes.slice(MAX_TAGS).filter((m) => MODES[m]).map((m) => MODES[m].label).join(", ");
  return `<p class="tags ex-tags">${tags.slice(0, MAX_TAGS).join("")}
      <span class="ex-more-tags" hidden>${tags.slice(MAX_TAGS).join("")}</span>
      <button type="button" class="tag ex-more" title="${escape(hidden)}" aria-expanded="false">+${tags.length - MAX_TAGS}</button></p>`;
}

function card(ex, { prep, sortable }) {
  const { total, unseen, due, new_today } = ex.stats;
  const todo = ex.assigned ? due + new_today : 0;
  const seen = total - unseen;
  const percent = total ? Math.round((seen / total) * 100) : 0;
  const who = audience(ex);
  return `
    <article class="exercise ex-card${todo ? " has-todo" : ""}" data-id="${ex.id}">
      <div class="ex-top">
        ${sortable ? `<button type="button" class="drag-handle" aria-label="Déplacer « ${escape(ex.name)} » (flèches)"
          title="Glisser pour ranger · ou flèches du clavier">⠿</button>` : ""}
        <h3 class="ex-title">${escape(ex.name)}</h3>
        ${!ex.assigned || !total ? ""
          : todo ? `<span class="ex-badge todo" title="${due} à revoir, ${new_today} nouvelles">${todo} à faire</span>`
          : '<span class="ex-badge done">✓ à jour</span>'}
      </div>
      ${ex.description ? `<p class="ex-desc muted small">${escape(ex.description)}</p>` : ""}
      ${who ? `<p class="ex-meta muted small">${who}</p>` : ""}
      ${modeTags(ex)}
      <div class="ex-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"
        aria-label="Cartes déjà vues">
        <div class="progress"><div class="progress-bar" style="width: ${percent}%"></div></div>
        <span class="small">${percent} %</span>
      </div>
      <p class="ex-stats small">
        <span class="due">${due} à revoir</span>
        <span class="new">${new_today} nouvelles</span>
        <span class="muted">${seen} / ${total} vues</span>
      </p>
      <div class="actions ex-actions">
        ${!ex.assigned || !total ? "" : `
          ${todo > 0
            ? `<a class="button ex-main" href="#/exercices/${ex.id}/test" title="Réponse attendue, notée">Test (${todo})</a>
               <a class="button secondary" href="#/exercices/${ex.id}/reviser"
                 title="Les mots défilent avec leur sens, leur prononciation et leur classificateur">Réviser</a>`
            : `<a class="button secondary ex-main" href="#/exercices/${ex.id}/reviser"
                 title="Les mots défilent avec leur sens, leur prononciation et leur classificateur">Réviser</a>`}
          <a class="button secondary ex-icon" href="#/exercices/${ex.id}/fiches"
            title="Fiches d'entraînement à l'écriture, à imprimer" aria-label="Fiches d'écriture">✍<span class="ex-icon-label"> Fiches</span></a>`}
      </div>
      ${footer(ex, prep)}
    </article>`;
}

// Bas de carte : hors ligne, modifier, suivi.
function footer(ex, prep) {
  const parts = [offlineLine(ex, prep)];
  if (ex.can_edit) {
    parts.push(`<a href="#/exercices/${ex.id}/modifier">Modifier</a>`,
      `<a href="#/exercices/${ex.id}/suivi" title="Progression des élèves">Suivi</a>`);
  }
  const links = parts.filter(Boolean);
  return links.length ? `<p class="ex-foot small">${links.join("")}</p>` : "";
}

// Hors ligne : préparer d'avance un exercice (file du test, tracés, audio).
function offlineLine(ex, prep) {
  if (!prep.supported || !ex.assigned || !ex.stats.total) return "";
  const done = prep.ready[ex.id];
  const when = done ? new Date(done.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
  return `<span class="offline-prep">
      ${done ? `<span class="tag done" title="Préparé le ${when}">✓ Prêt hors ligne</span>` : ""}
      <button type="button" class="link-button" data-prepare="${ex.id}"
        title="Charger maintenant la file du test, les tracés et l'audio de ses mots">
        ${done ? "mettre à jour" : "⬇ Préparer hors ligne"}</button>
    </span>`;
}

function bindOfflinePrep(el) {
  el.querySelectorAll("[data-prepare]").forEach((button) => button.addEventListener("click", async () => {
    const line = button.closest(".offline-prep");
    button.disabled = true;
    try {
      const { files, missing } = await prepareExercise(button.dataset.prepare, (done, total) => {
        button.textContent = `Préparation… ${total ? Math.round((done / total) * 100) : 0} %`;
      });
      line.innerHTML = '<span class="tag done">✓ Prêt hors ligne</span> <span class="muted">à l’instant</span>';
      toast(`Exercice prêt hors ligne (${files} fichiers${missing ? `, ${missing} indisponibles` : ""}).`, "success");
    } catch (err) {
      toast(`Préparation impossible : ${err.message}`, "error");
      button.disabled = false;
      button.textContent = "⬇ Préparer hors ligne";
    }
  }));
}

// « +N » : affiche les autres modes.
function bindTags(el) {
  el.querySelectorAll(".ex-more").forEach((button) => button.addEventListener("click", () => {
    const more = button.parentElement.querySelector(".ex-more-tags");
    more.hidden = !more.hidden;
    button.setAttribute("aria-expanded", String(!more.hidden));
    button.textContent = more.hidden ? `+${more.children.length}` : "−";
  }));
}

// ------------------------------------------------------------------ ranger les cartes

let saveTimer = null;

function saveOrder(el) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ids = [...el.querySelectorAll("[data-sortable] > [data-id]")].map((c) => Number(c.dataset.id));
    try {
      await api("/exercises/order", { method: "PUT", body: { ids } });
    } catch (err) {
      toast(`Ordre non enregistré : ${err.message}`, "error");
    }
  }, 300);
}

// Déplace `item` avant `ref` (null : à la fin) en animant le glissement des cartes (FLIP).
function moveAnimated(grid, item, ref) {
  const cards = [...grid.children];
  const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
  grid.insertBefore(item, ref);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const c of cards) {
    if (c === item) continue;
    const from = before.get(c);
    const to = c.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (!dx && !dy) continue;
    c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 180, easing: "ease-out" });
  }
}

/**
 * Glisser-déposer des cartes d'une grille par leur poignée : souris, doigt ou stylet (événements
 * « pointer »), et clavier (flèches sur la poignée). `onChange` après chaque déplacement.
 */
function enableReorder(grid, onChange) {
  grid.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || e.button > 0) return;
    const item = handle.closest("[data-id]");
    if (item?.parentElement !== grid) return;
    e.preventDefault();
    // Écoute sur tout le document : déplacer la carte dans la page fait perdre la capture du
    // pointeur par la poignée.
    const pointer = e.pointerId;
    item.classList.add("dragging");
    grid.classList.add("reordering");
    let moved = false;
    let scroll = 0;
    let frame = null;
    const autoscroll = () => {
      if (scroll) window.scrollBy(0, scroll);
      frame = requestAnimationFrame(autoscroll);
    };
    frame = requestAnimationFrame(autoscroll);

    const onMove = (ev) => {
      if (ev.pointerId !== pointer) return;
      ev.preventDefault();
      // Près du haut ou du bas de l'écran : la page défile.
      scroll = ev.clientY < 70 ? -12 : ev.clientY > innerHeight - 70 ? 12 : 0;
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-id]");
      if (!target || target === item || target.parentElement !== grid) return;
      const cards = [...grid.children];
      const forward = cards.indexOf(target) > cards.indexOf(item);
      moveAnimated(grid, item, forward ? target.nextElementSibling : target);
      moved = true;
    };
    const onEnd = (ev) => {
      if (ev.pointerId !== pointer) return;
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      item.classList.remove("dragging");
      grid.classList.remove("reordering");
      if (moved) onChange();
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  });

  grid.addEventListener("keydown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const item = handle.closest("[data-id]");
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const next = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (!back && !next) return;
    e.preventDefault();
    if (back && item.previousElementSibling) moveAnimated(grid, item, item.previousElementSibling);
    else if (next && item.nextElementSibling) moveAnimated(grid, item, item.nextElementSibling.nextElementSibling);
    else return;
    handle.focus();
    onChange();
  });
}
