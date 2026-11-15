import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { toast } from "../ui.js";
import { openWordDialog } from "./word-dialog.js";

// Mes mots : les mots gardés depuis la lecture assistée ou la fiche d'un mot, avec ma note sur
// chacun. Ils se révisent et se testent comme un exercice, et le fil les reprend.

function wordRow(w, inList) {
  return `
    <li class="my-word-row">
      <button type="button" class="my-word-main" data-open="${w.word_id}" title="Fiche du mot, ma note">
        <span class="my-word-hanzi" lang="zh">${escape(w.hanzi)}</span>
        <span class="my-word-text">
          <span><strong>${escape(w.pinyin)}</strong> · ${escape(w.translation)}${w.personal ? ' <span class="tag" title="Absent du vocabulaire, gardé par toi">perso</span>' : ""}</span>
          ${w.note ? `<span class="word-note">${escape(w.note)}</span>` : '<span class="muted small">Ajouter une note…</span>'}
        </span>
      </button>
      ${speakButton(w.hanzi, { pinyin: w.pinyin })}
      ${inList ? `<button type="button" class="icon-button" data-remove="${w.word_id}" data-hanzi="${escape(w.hanzi)}"
        ${w.personal ? 'data-personal="1"' : ""}
        aria-label="Retirer ${escape(w.hanzi)} de Mes mots">✕</button>` : ""}
    </li>`;
}

export async function myWordsView(el) {
  async function load() {
    const data = await api("/my-words");
    const ex = data.exercise;
    const stats = ex?.stats;
    const todo = stats ? stats.due + stats.new_today : 0;
    el.innerHTML = `
      <div class="toolbar">
        <div>
          <h2>Mes mots</h2>
          <p class="muted small">${data.words.length
            ? `${data.words.length} mot${data.words.length > 1 ? "s" : ""} gardé${data.words.length > 1 ? "s" : ""} · repris par tes pas du fil`
            : "Garde les mots qui t'intéressent : ils entreront dans tes révisions."}</p>
        </div>
        ${ex && data.words.length ? `<div class="actions">
          <a class="button secondary" href="#/exercices/${ex.id}/reviser">Réviser</a>
          ${todo ? `<a class="button" href="#/exercices/${ex.id}/test">Test (${todo})</a>` : '<span class="muted small">Test à jour ✓</span>'}
          <a class="button secondary" href="#/exercices/${ex.id}/fiches">✍ Fiches</a>
        </div>` : ""}
      </div>
      ${data.words.length ? `<ul class="my-words">${data.words.map((w) => wordRow(w, true)).join("")}</ul>` : `
        <div class="empty">
          <p>Aucun mot pour l'instant.</p>
          <p>Dans la <a href="#/lecture">lecture assistée</a>, touche un mot puis « ＋ Mes mots »
            (même absent du vocabulaire : tu lui donnes son sens) ; ou ouvre la fiche d'un mot depuis
            le <a href="#/vocabulaire">vocabulaire</a>.</p>
        </div>`}
      ${data.notes.length ? `
        <h3 class="section-title">Autres mots annotés</h3>
        <ul class="my-words">${data.notes.map((w) => wordRow(w, false)).join("")}</ul>` : ""}`;
    bindSpeakButtons(el);
    el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () =>
      openWordDialog(Number(b.dataset.open), {}, () => { changed = true; })
        .then(() => document.querySelector("dialog.word-dialog")?.addEventListener("close", () => {
          if (changed) load();
          changed = false;
        }))));
    el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.personal && !confirm(`${b.dataset.hanzi} est un mot personnel : le retirer le supprime, avec ta progression et ta note. Continuer ?`)) return;
      try {
        await api(`/my-words/${b.dataset.remove}`, { method: "DELETE" });
        toast(`${b.dataset.hanzi} retiré de Mes mots.`);
        load();
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
      }
    }));
  }
  let changed = false;
  await load();
}
