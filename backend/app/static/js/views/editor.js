import { ANSWER_HINTS, api, escape, MODES } from "../api.js";
import { attachKeyboard } from "../keyboard.js";
import { displayName } from "../session.js";
import { bindPager, paginate, pagerHtml, toast } from "../ui.js";

export async function editorView(el, { id }) {
  const [decks, words, groups, exercise] = await Promise.all([
    api("/decks"),
    api("/words"),
    api("/admin/groups"),
    id
      ? api(`/exercises/${id}`)
      : Promise.resolve({ name: "", description: "", modes: ["hanzi_to_meaning"],
          new_per_day: 10, all_words: false, deck_ids: [], word_ids: [],
          everyone: false, group_ids: [], public: false }),
  ]);
  if (id && !exercise.can_edit) {
    el.innerHTML = `<div class="empty"><p>Seul l'auteur de cet exercice (ou un administrateur) peut le modifier.</p>
      <p><a href="#/">Retour aux exercices</a></p></div>`;
    return;
  }

  // Mots choisis un par un : gardés hors du DOM pour survivre au changement de page.
  const selected = new Set(exercise.word_ids);
  const pickState = { q: "", deck: "", onlySelected: false, page: 1, size: 25 };

  el.innerHTML = `
    <div class="toolbar">
      <h2>${id ? "Modifier l'exercice" : "Nouvel exercice"}</h2>
      <a href="#/" class="muted">← Retour aux exercices</a>
    </div>
    <form id="exercise-form" class="stack">
      <div class="row">
        <label>Nom
          <input name="name" required value="${escape(exercise.name)}" placeholder="ex. HSK 1 — reconnaissance">
        </label>
        <label>Nouvelles cartes par jour
          <input name="new_per_day" type="number" min="0" max="500" value="${exercise.new_per_day}">
        </label>
      </div>
      <label>Description
        <input name="description" value="${escape(exercise.description)}" placeholder="facultatif">
      </label>

      <fieldset>
        <legend>Modes de révision</legend>
        <p class="muted small">Les modes décident des questions du <strong>test</strong> (réponse attendue, notée).
          La <strong>révision</strong> montre simplement chaque mot avec son sens, sa prononciation et son classificateur.</p>
        <div class="mode-grid">
          ${Object.entries(MODES).map(([value, { label, answer, audio }]) => `
            <label class="mode-option">
              <input type="checkbox" name="mode" value="${value}"
                ${exercise.modes.includes(value) ? "checked" : ""}>
              <span>${label}</span>
              <small class="muted">${audio ? "audio · " : ""}${ANSWER_HINTS[answer]}</small>
            </label>`).join("")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Contenu de l'exercice</legend>
        <label class="check">
          <input type="checkbox" name="all_words" ${exercise.all_words ? "checked" : ""}>
          Tout le vocabulaire (y compris les mots ajoutés plus tard)
        </label>
        <div id="selection">
          <h4>Listes entières</h4>
          <div class="chips">
            ${decks.map((d) => `
              <label class="chip">
                <input type="checkbox" name="deck" value="${d.id}"
                  ${exercise.deck_ids.includes(d.id) ? "checked" : ""}>
                ${escape(d.name)} <span class="muted">${d.word_count}</span>
              </label>`).join("") || '<p class="muted">Aucune liste.</p>'}
          </div>

          <h4>Mots choisis un par un <span id="picked-count" class="muted small"></span></h4>
          <div class="row">
            <input id="word-filter" type="search" placeholder="Filtrer (hanzi, pinyin, traduction)…" aria-label="Filtrer les mots">
            <select id="word-deck" aria-label="Filtrer par liste">
              <option value="">Toutes les listes</option>
              ${decks.map((d) => `<option value="${d.id}">${escape(d.name)}</option>`).join("")}
            </select>
          </div>
          <div class="actions small-actions">
            <label class="check small"><input type="checkbox" id="only-selected"> Seulement les mots cochés</label>
            <button type="button" class="secondary" id="check-filtered">Cocher les mots filtrés</button>
            <button type="button" class="secondary" id="uncheck-filtered">Décocher les mots filtrés</button>
          </div>
          <div class="table-wrap">
            <table class="data compact">
              <tbody id="pick-words"></tbody>
            </table>
          </div>
          <div id="pick-pager"></div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Attribué à</legend>
        <label class="check">
          <input type="checkbox" name="public" ${exercise.public ? "checked" : ""}>
          Public : n'importe qui peut le réviser, sans compte
        </label>
        <p class="muted small">Un visiteur garde sa progression dans son navigateur ; elle rejoint
          son compte s'il se connecte.</p>
        <label class="check">
          <input type="checkbox" name="everyone" ${exercise.everyone ? "checked" : ""}>
          Tous les comptes
        </label>
        <div id="audience">
          <p class="muted small">Les membres des groupes cochés le voient dans leurs exercices ; chacun a sa propre progression.
            ${exercise.owner_username ? `Auteur : ${escape(displayName({ username: exercise.owner_username, display_name: exercise.owner_name }))}.` : ""}</p>
          <div class="chips">
            ${groups.map((g) => `
              <label class="chip">
                <input type="checkbox" name="group" value="${g.id}" ${exercise.group_ids.includes(g.id) ? "checked" : ""}>
                ${escape(g.name)} <span class="muted">${g.member_ids.length}</span>
              </label>`).join("") || '<p class="muted small">Aucun groupe : l\'administrateur les crée dans « Administration ».</p>'}
          </div>
        </div>
      </fieldset>

      <div class="sticky-footer">
        <p id="summary" class="muted"></p>
        <div class="actions">
          <button type="submit">Enregistrer</button>
          <a class="button secondary" href="#/">Annuler</a>
          ${id ? '<button type="button" id="delete" class="danger">Supprimer</button>' : ""}
        </div>
      </div>
    </form>`;

  const form = el.querySelector("#exercise-form");
  const checkedValues = (name) =>
    [...form.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.value);

  function filteredWords() {
    const q = pickState.q.trim().toLowerCase();
    const deckId = Number(pickState.deck) || null;
    return words.filter(
      (w) =>
        (!pickState.onlySelected || selected.has(w.id)) &&
        (!deckId || w.deck_ids.includes(deckId)) &&
        (!q || `${w.hanzi} ${w.pinyin} ${w.translation}`.toLowerCase().includes(q))
    );
  }

  function renderPicker() {
    const page = paginate(filteredWords(), pickState);
    el.querySelector("#pick-words").innerHTML = page.items.map((w) => `
      <tr>
        <td class="check-col"><input type="checkbox" data-word="${w.id}" ${selected.has(w.id) ? "checked" : ""}
          aria-label="Choisir ${escape(w.hanzi)}"></td>
        <td class="hanzi-sm">${escape(w.hanzi)}</td>
        <td>${escape(w.pinyin)}</td>
        <td class="muted">${escape(w.translation)}</td>
      </tr>`).join("") || '<tr><td class="muted center">Aucun mot.</td></tr>';
    el.querySelector("#pick-pager").innerHTML = pagerHtml(page, pickState, "mot(s)");
    el.querySelector("#picked-count").textContent = selected.size ? `(${selected.size} coché(s))` : "";
  }

  // Nombre de mots distincts couverts par la sélection courante.
  function updateSummary() {
    const allWords = form.elements.all_words.checked;
    el.querySelector("#selection").hidden = allWords;
    el.querySelector("#audience").hidden = form.elements.everyone.checked;
    let count = words.length;
    if (!allWords) {
      const deckIds = new Set(checkedValues("deck").map(Number));
      count = words.filter((w) => w.deck_ids.some((d) => deckIds.has(d)) || selected.has(w.id)).length;
    }
    const modes = checkedValues("mode").length;
    el.querySelector("#summary").innerHTML =
      `<strong>${count}</strong> mot(s) × <strong>${modes}</strong> mode(s) = <strong>${count * modes}</strong> carte(s)`;
  }

  form.addEventListener("change", (e) => {
    if (e.target.dataset.word) {
      const wordId = Number(e.target.dataset.word);
      e.target.checked ? selected.add(wordId) : selected.delete(wordId);
      el.querySelector("#picked-count").textContent = selected.size ? `(${selected.size} coché(s))` : "";
    }
    updateSummary();
  });

  attachKeyboard(el.querySelector("#word-filter"), "hanzi");
  el.querySelector("#word-filter").addEventListener("input", (e) => {
    pickState.q = e.target.value;
    pickState.page = 1;
    renderPicker();
  });
  el.querySelector("#word-deck").addEventListener("change", (e) => {
    e.stopPropagation();
    pickState.deck = e.target.value;
    pickState.page = 1;
    renderPicker();
  });
  el.querySelector("#only-selected").addEventListener("change", (e) => {
    e.stopPropagation();
    pickState.onlySelected = e.target.checked;
    pickState.page = 1;
    renderPicker();
  });
  for (const [buttonId, check] of [["#check-filtered", true], ["#uncheck-filtered", false]]) {
    el.querySelector(buttonId).addEventListener("click", () => {
      const ids = filteredWords().map((w) => w.id);
      ids.forEach((wordId) => (check ? selected.add(wordId) : selected.delete(wordId)));
      toast(`${ids.length} mot(s) ${check ? "coché(s)" : "décoché(s)"}`);
      renderPicker();
      updateSummary();
    });
  }
  bindPager(el.querySelector("#pick-pager"), pickState, renderPicker);

  renderPicker();
  updateSummary();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim() || null,
      modes: checkedValues("mode"),
      new_per_day: Number(form.elements.new_per_day.value),
      all_words: form.elements.all_words.checked,
      deck_ids: checkedValues("deck").map(Number),
      word_ids: [...selected],
      everyone: form.elements.everyone.checked,
      public: form.elements.public.checked,
      group_ids: form.elements.everyone.checked ? [] : checkedValues("group").map(Number),
    };
    if (!body.modes.length) {
      toast("Choisis au moins un mode de révision.", "error");
      return;
    }
    try {
      await api(id ? `/exercises/${id}` : "/exercises", { method: id ? "PUT" : "POST", body });
      toast(`Exercice « ${body.name} » enregistré`, "success");
      location.hash = "#/";
    } catch (err) {
      toast(err.message, "error");
    }
  });

  el.querySelector("#delete")?.addEventListener("click", async () => {
    if (!confirm("Supprimer cet exercice pour tous ses élèves ? (la progression des mots est conservée)")) return;
    await api(`/exercises/${id}`, { method: "DELETE" });
    toast("Exercice supprimé");
    location.hash = "#/";
  });
}
