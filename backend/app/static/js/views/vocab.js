import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { attachKeyboard } from "../keyboard.js";
import { numbersToMarks } from "../pinyin.js";
import { can } from "../session.js";
import { bindPager, paginate, pagerHtml, remember, save, toast, withBusy } from "../ui.js";
import { openWordDialog } from "./word-dialog.js";

const STATE_KEY = "chinese.vocab";
const SORTS = {
  id: (a, b) => a.id - b.id,
  hanzi: (a, b) => a.hanzi.localeCompare(b.hanzi, "zh"),
  pinyin: (a, b) => a.pinyin.localeCompare(b.pinyin, "fr", { sensitivity: "base" }),
  translation: (a, b) => a.translation.localeCompare(b.translation, "fr", { sensitivity: "base" }),
};

export async function vocabView(el) {
  const state = remember(STATE_KEY, { q: "", deck: "", sort: "id", desc: false, page: 1, size: 25 });
  // Lecture libre ; ajouter, importer et supprimer demandent le droit « manage_vocab ».
  const editor = can("manage_vocab");

  el.innerHTML = `
    <div class="toolbar">
      <h2>Vocabulaire <span id="total" class="muted small"></span></h2>
      <div class="actions" ${editor ? "" : "hidden"}>
        <button type="button" class="secondary" data-toggle="packs-panel">📦 Listes prêtes</button>
        <button type="button" data-toggle="add-panel">+ Ajouter un mot</button>
      </div>
    </div>

    <details id="packs-panel" class="panel" ${editor ? "" : "hidden"}>
      <summary>Listes prêtes à importer</summary>
      <div id="packs" class="packs"></div>
    </details>

    <details id="add-panel" class="panel" ${editor ? "" : "hidden"}>
      <summary>Ajouter un mot ou une liste</summary>
      <form id="word-form" class="row">
        <input name="hanzi" placeholder="汉字" required aria-label="Hanzi">
        <input name="pinyin" placeholder="pinyin (ex. ni3 hao3)" required aria-label="Pinyin">
        <input name="translation" placeholder="traduction" required aria-label="Traduction">
        <select name="deck_id" id="deck-select" aria-label="Liste"></select>
        <button type="submit">Ajouter</button>
      </form>
      <form id="deck-form" class="row">
        <input name="name" placeholder="Nouvelle liste (ex. Restaurant, Famille…)" required aria-label="Nom de la liste">
        <button type="submit" class="secondary">Créer la liste</button>
      </form>
    </details>

    <div class="filters row">
      <input id="search" type="search" placeholder="Rechercher (hanzi, pinyin, traduction)…  /"
        aria-label="Rechercher" value="${escape(state.q)}">
      <select id="deck-filter" aria-label="Filtrer par liste"></select>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th><button type="button" class="sort" data-sort="hanzi">Hanzi</button></th>
          <th><button type="button" class="sort" data-sort="pinyin">Pinyin</button></th>
          <th><button type="button" class="sort" data-sort="translation">Traduction</button></th>
          <th class="hide-narrow" title="Classificateurs">量词</th>
          <th class="hide-narrow">Listes</th>
          <th class="actions-col"><button type="button" class="sort" data-sort="id" title="Ordre d'ajout">#</button></th>
        </tr></thead>
        <tbody id="words"></tbody>
      </table>
    </div>
    <div id="pager"></div>`;

  let decks = [];
  let words = [];
  let deckName = {};

  function renderWords() {
    save(STATE_KEY, state);
    const q = state.q.trim().toLowerCase();
    const deckId = Number(state.deck) || null;
    const filtered = words
      .filter(
        (w) =>
          (!deckId || w.deck_ids.includes(deckId)) &&
          (!q || `${w.hanzi} ${w.pinyin} ${w.translation}`.toLowerCase().includes(q))
      )
      .sort(SORTS[state.sort]);
    if (state.desc) filtered.reverse();
    const page = paginate(filtered, state);

    el.querySelector("#total").textContent = `(${words.length} mots)`;
    el.querySelectorAll(".sort").forEach((b) => {
      const active = b.dataset.sort === state.sort;
      b.classList.toggle("active", active);
      b.dataset.dir = active ? (state.desc ? "desc" : "asc") : "";
      b.closest("th").setAttribute("aria-sort", active ? (state.desc ? "descending" : "ascending") : "none");
    });
    el.querySelector("#words").innerHTML = page.items.map((w) => `
      <tr class="clickable" data-word="${w.id}" tabindex="0" title="Voir la fiche du mot">
        <td class="hanzi">${escape(w.hanzi)} ${speakButton(w.hanzi, { pinyin: w.pinyin })}</td>
        <td>${escape(w.pinyin)}</td>
        <td>${escape(w.translation)}</td>
        <td class="hide-narrow hanzi-sm">${w.classifiers.map(escape).join(" ")}</td>
        <td class="hide-narrow">${w.deck_ids.map((id) => `<span class="tag">${escape(deckName[id])}</span>`).join(" ")}</td>
        <td class="actions-col">${editor ? `<button type="button" class="link" data-delete="${w.id}" title="Supprimer" aria-label="Supprimer ${escape(w.hanzi)}">✕</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted center">${
        words.length ? "Aucun mot ne correspond à la recherche." : "Aucun mot : importe une liste ou ajoute un mot."
      }</td></tr>`;
    el.querySelector("#pager").innerHTML = pagerHtml(page, state, "mot(s)");
  }

  function renderPacks(packs) {
    const pack = (p) => {
      const complete = p.imported_count >= p.word_count && p.with_examples >= p.example_count;
      return `<div class="pack">
        <strong>${escape(p.name)}</strong>
        <span class="muted">${escape(p.description)} · ${p.word_count} mots
          ${p.example_count ? ` · ${p.example_count} exemples` : ""}</span>
        ${complete
          ? '<span class="done">✓ importée</span>'
          : `<button type="button" data-pack="${p.id}">${p.deck_id ? "Compléter" : "Importer"}</button>`}
      </div>`;
    };
    const categories = [...new Set(packs.map((p) => p.category))];
    el.querySelector("#packs").innerHTML = categories.map((category) => `
      <h4 class="pack-category">${escape(category)}</h4>
      ${packs.filter((p) => p.category === category).map(pack).join("")}`).join("");
    // Rien d'importé : on ouvre directement le panneau des listes.
    if (editor && !packs.some((p) => p.deck_id)) el.querySelector("#packs-panel").open = true;
  }

  async function load() {
    const [d, w, packs] = await Promise.all([api("/decks"), api("/words"), api("/packs")]);
    decks = d;
    words = w;
    deckName = Object.fromEntries(decks.map((x) => [x.id, x.name]));
    const options = (empty) =>
      `<option value="">${empty}</option>` +
      decks.map((x) => `<option value="${x.id}">${escape(x.name)} (${x.word_count})</option>`).join("");
    const select = el.querySelector("#deck-select");
    const selected = select.value;
    select.innerHTML = options("(sans liste)");
    select.value = selected;
    const filter = el.querySelector("#deck-filter");
    filter.innerHTML = options("Toutes les listes");
    filter.value = state.deck;
    renderPacks(packs);
    renderWords();
  }

  el.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      const panel = el.querySelector(`#${b.dataset.toggle}`);
      panel.open = !panel.open;
      if (panel.open) panel.querySelector("input")?.focus();
    })
  );

  el.querySelector("#word-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api("/words", {
        method: "POST",
        body: {
          ...data,
          pinyin: numbersToMarks(data.pinyin),
          deck_id: data.deck_id ? Number(data.deck_id) : null,
        },
      });
      toast(`« ${data.hanzi} » ajouté`, "success");
      e.target.reset();
      e.target.elements.deck_id.value = data.deck_id;
      e.target.elements.hanzi.focus();
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  el.querySelector("#deck-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const deck = await api("/decks", { method: "POST", body: data });
      toast(`Liste « ${deck.name} » créée`, "success");
      e.target.reset();
      await load();
      el.querySelector("#deck-select").value = deck.id;
    } catch (err) {
      toast(err.message, "error");
    }
  });

  el.querySelector("#packs").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-pack]");
    if (!button) return;
    try {
      const result = await withBusy(button, "Import…", () =>
        api(`/packs/${button.dataset.pack}/import`, { method: "POST" })
      );
      toast(`${result.added} mot(s) et ${result.added_examples} exemple(s) ajoutés`, "success");
      state.deck = String(result.deck_id);
      state.page = 1;
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const wordForm = el.querySelector("#word-form");
  attachKeyboard(wordForm.elements.hanzi, "hanzi");
  attachKeyboard(wordForm.elements.pinyin, "pinyin");

  const search = el.querySelector("#search");
  attachKeyboard(search, "hanzi");
  search.addEventListener("input", () => {
    state.q = search.value;
    state.page = 1;
    renderWords();
  });
  el.querySelector("#deck-filter").addEventListener("change", (e) => {
    state.deck = e.target.value;
    state.page = 1;
    renderWords();
  });
  el.querySelector("thead").addEventListener("click", (e) => {
    const button = e.target.closest("[data-sort]");
    if (!button) return;
    state.desc = state.sort === button.dataset.sort ? !state.desc : false;
    state.sort = button.dataset.sort;
    renderWords();
  });
  bindPager(el.querySelector("#pager"), state, () => {
    renderWords();
    el.querySelector(".filters").scrollIntoView({ block: "nearest" });
  });

  bindSpeakButtons(el.querySelector("#words"));
  const tbody = el.querySelector("#words");
  tbody.addEventListener("click", async (e) => {
    if (e.target.closest("[data-speak]")) return;
    const del = e.target.closest("[data-delete]");
    if (del) {
      const word = words.find((w) => w.id === Number(del.dataset.delete));
      if (!confirm(`Supprimer « ${word.hanzi} » et son historique de révision ?`)) return;
      await api(`/words/${word.id}`, { method: "DELETE" });
      toast(`« ${word.hanzi} » supprimé`);
      await load();
      return;
    }
    const row = e.target.closest("[data-word]");
    if (row) openWordDialog(Number(row.dataset.word), deckName, load);
  });
  tbody.addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-word]");
    if (row && e.key === "Enter") openWordDialog(Number(row.dataset.word), deckName, load);
  });

  // "/" place le curseur dans la recherche.
  const onKey = (e) => {
    if (e.key === "/" && !e.target.matches("input, textarea, select") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener("keydown", onKey);

  await load();
  return () => document.removeEventListener("keydown", onKey);
}
