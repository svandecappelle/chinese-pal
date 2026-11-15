import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { toast } from "../ui.js";

// Mots des élèves (page Vocabulaire, éditeurs) : les mots gardés dans Mes mots hors vocabulaire,
// les plus gardés d'abord. « Ajouter » en fait un mot du vocabulaire commun ; les élèves gardent
// leur liste, leur progression et leurs notes.

const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;

/** Remplit `box` ; renvoie le nombre de mots proposés. `onAdopted` : après un ajout. */
export async function renderStudentWords(box, decks, onAdopted) {
  const rows = await api("/student-words");
  const deckOptions = '<option value="">(sans liste)</option>'
    + decks.map((d) => `<option value="${d.id}">${escape(d.name)}</option>`).join("");
  box.innerHTML = rows.length ? `
    <p class="muted small">Mots gardés par des élèves dans « Mes mots » alors qu'ils manquent au
      vocabulaire, avec le sens qu'ils leur ont donné. Les ajouter les rend disponibles à tous ;
      les élèves gardent leur liste, leur progression et leurs notes.</p>
    <ul class="student-words">${rows.map((w, i) => `
      <li class="student-word">
        <div class="student-word-head">
          <span class="hanzi-sm" lang="zh">${escape(w.hanzi)}</span>
          ${speakButton(w.hanzi, { pinyin: w.pinyin })}
          <strong>${escape(w.pinyin)}</strong>
          <span class="tag">${plural(w.students, "élève")}</span>
        </div>
        <p class="muted small">Sens donnés : ${w.translations.slice(0, 4).map(escape).join(" · ")}</p>
        <form class="row student-word-form" data-index="${i}">
          <input name="translation" required maxlength="200" value="${escape(w.translations[0])}"
            aria-label="Traduction de ${escape(w.hanzi)}" ${w.shared_id ? "hidden" : ""}>
          <select name="deck_id" aria-label="Liste">${deckOptions}</select>
          <button type="submit">${w.shared_id ? "Rattacher au vocabulaire" : "Ajouter au vocabulaire"}</button>
        </form>
        ${w.shared_id ? '<p class="muted small">Déjà dans le vocabulaire : leurs mots personnels y seront rattachés.</p>' : ""}
      </li>`).join("")}</ul>`
    : '<p class="muted">Aucun mot gardé hors vocabulaire par les élèves.</p>';
  bindSpeakButtons(box);
  box.querySelectorAll(".student-word-form").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = rows[Number(form.dataset.index)];
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const word = await api("/student-words/adopt", {
        method: "POST",
        body: {
          hanzi: w.hanzi,
          pinyin: w.pinyin,
          translation: form.elements.translation.value.trim(),
          deck_id: form.elements.deck_id.value ? Number(form.elements.deck_id.value) : null,
        },
      });
      toast(`« ${word.hanzi} » ajouté au vocabulaire (${plural(word.merged, "élève")}).`, "success");
      onAdopted?.();
    } catch (err) {
      toast(err.message, "error");
      button.disabled = false;
    }
  }));
  return rows.length;
}
