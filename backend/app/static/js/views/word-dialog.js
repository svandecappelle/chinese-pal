import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton, stopSpeaking } from "../audio.js";
import { numbersToMarks } from "../pinyin.js";
import { mountStrokes } from "../strokes.js";

// Fiche d'un mot dans une boîte de dialogue : prononciation, ordre des traits, exemples.
// `onChange` est appelé après l'ajout ou la suppression d'un exemple.
export async function openWordDialog(wordId, deckNames, onChange) {
  const word = await api(`/words/${wordId}`);
  const dialog = document.createElement("dialog");
  dialog.className = "word-dialog";
  document.body.append(dialog);

  dialog.innerHTML = `
    <form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Fermer">✕</button></form>
    <div class="answer-word">
      <span class="big-hanzi">${escape(word.hanzi)}</span>
      ${speakButton(word.hanzi, { pinyin: word.pinyin })}
    </div>
    <div class="pinyin center">${escape(word.pinyin)}</div>
    <div class="meaning center">${escape(word.translation)}</div>
    <p class="tags center">
      ${word.deck_ids.map((id) => `<span class="tag">${escape(deckNames[id] ?? "")}</span>`).join("")}
    </p>

    <h3>Ordre des traits</h3>
    <div id="dialog-strokes" class="strokes"></div>
    <div class="actions center-actions">
      <button type="button" id="animate" class="secondary">▶ Animer</button>
      <button type="button" id="quiz" class="secondary">✍ M'entraîner à tracer</button>
    </div>
    <p id="quiz-result" class="muted center"></p>

    <h3>Exemples</h3>
    <ul id="examples" class="examples"></ul>
    <form id="example-form" class="stack">
      <input name="hanzi" placeholder="Phrase en chinois" required>
      <div class="row">
        <input name="pinyin" placeholder="pinyin (ex. wo3 ai4 ni3)">
        <input name="translation" placeholder="traduction">
      </div>
      <button type="submit">Ajouter l'exemple</button>
      <p id="example-error" class="error"></p>
    </form>`;

  bindSpeakButtons(dialog);
  const strokes = mountStrokes(dialog.querySelector("#dialog-strokes"), word.hanzi);
  dialog.querySelector("#animate").addEventListener("click", () => strokes.animate());
  dialog.querySelector("#quiz").addEventListener("click", () => {
    const result = dialog.querySelector("#quiz-result");
    result.textContent = "Trace les traits dans l'ordre, case par case.";
    strokes.quiz((mistakes) => {
      result.textContent = mistakes === 0
        ? "✓ Parfait, aucune erreur !"
        : `Terminé avec ${mistakes} erreur(s).`;
    });
  });

  function renderExamples() {
    dialog.querySelector("#examples").innerHTML = word.examples.map((e) => `
      <li>
        <div>${escape(e.hanzi)} ${speakButton(e.hanzi, { label: "Écouter la phrase" })}</div>
        <div class="muted">${escape(e.pinyin)}</div>
        <div>${escape(e.translation)}</div>
        <button type="button" class="link" data-delete="${e.id}" title="Supprimer l'exemple">✕</button>
      </li>`).join("") || '<li class="muted">Aucun exemple pour ce mot.</li>';
  }
  renderExamples();

  dialog.querySelector("#examples").addEventListener("click", async (e) => {
    const id = e.target.dataset.delete;
    if (!id || !confirm("Supprimer cet exemple ?")) return;
    await api(`/examples/${id}`, { method: "DELETE" });
    word.examples = word.examples.filter((x) => x.id !== Number(id));
    renderExamples();
    onChange?.();
  });

  dialog.querySelector("#example-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const example = await api(`/words/${wordId}/examples`, {
        method: "POST",
        body: { ...data, pinyin: numbersToMarks(data.pinyin) },
      });
      word.examples.push(example);
      e.target.reset();
      dialog.querySelector("#example-error").textContent = "";
      renderExamples();
      onChange?.();
    } catch (err) {
      dialog.querySelector("#example-error").textContent = err.message;
    }
  });

  dialog.addEventListener("close", () => {
    stopSpeaking();
    dialog.remove();
  });
  // Clic sur le fond (hors du contenu) : fermeture.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.showModal();
}
