import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton, stopSpeaking } from "../audio.js";
import { attachKeyboard } from "../keyboard.js";
import { numbersToMarks } from "../pinyin.js";
import { can, session } from "../session.js";
import { mountStrokes } from "../strokes.js";
import { toast } from "../ui.js";

// Fiche d'un mot dans une boîte de dialogue : prononciation, ordre des traits, exemples.
// `onChange` est appelé après un changement (exemple, classificateur, Mes mots, note).
export async function openWordDialog(wordId, deckNames, onChange) {
  const word = await api(`/words/${wordId}`);
  // Un mot personnel (gardé par l'élève hors vocabulaire) n'est modifiable que par lui.
  const editor = can("manage_vocab") && !word.personal;
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
      ${word.personal ? '<span class="tag">mot personnel</span>' : ""}
    </p>
    ${session.user ? `
    <section class="my-word" aria-label="Mes mots">
      <div class="center"><button type="button" id="my-toggle" class="secondary small-button" disabled>Mes mots…</button></div>
      ${word.personal ? `<label>Mon sens <small class="muted">(mot absent du vocabulaire, gardé par toi)</small>
        <input id="my-meaning" maxlength="200" required value="${escape(word.translation)}">
      </label>` : ""}
      <label>Ma note <small class="muted">(moyen mnémotechnique, visible de toi seul, montré avec la réponse)</small>
        <textarea id="my-note" rows="2" maxlength="500" placeholder="ex. 好 : une femme 女 et son enfant 子"></textarea>
      </label>
      <div><button type="button" id="my-note-save" class="secondary small-button">${word.personal ? "Enregistrer" : "Enregistrer la note"}</button></div>
    </section>` : ""}

    <h3>Classificateur <small class="muted">量词</small></h3>
    <div id="measure" class="measure"></div>
    <form id="classifier-form" class="row" ${editor ? "" : "hidden"}>
      <input name="classifiers" value="${escape(word.classifiers.join(" "))}"
        placeholder="ex. 本 (plusieurs : séparés par des espaces)" aria-label="Classificateurs">
      <button type="submit" class="secondary">Enregistrer</button>
    </form>

    <h3>Ordre des traits</h3>
    <div id="dialog-strokes" class="strokes"></div>
    <div class="actions center-actions">
      <button type="button" id="animate" class="secondary">▶ Animer</button>
      <button type="button" id="quiz" class="secondary">✍ M'entraîner à tracer</button>
    </div>
    <p id="quiz-result" class="muted center"></p>

    <h3>Exemples</h3>
    <ul id="examples" class="examples"></ul>
    <form id="example-form" class="stack" ${editor ? "" : "hidden"}>
      <input name="hanzi" placeholder="Phrase en chinois" required>
      <div class="row">
        <input name="pinyin" placeholder="pinyin (ex. wo3 ai4 ni3)">
        <input name="translation" placeholder="traduction">
      </div>
      <button type="submit">Ajouter l'exemple</button>
      <p id="example-error" class="error"></p>
    </form>`;

  bindSpeakButtons(dialog);
  if (session.user) bindMyWord(dialog, word, onChange);
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
        ${editor ? `<button type="button" class="link" data-delete="${e.id}" title="Supprimer l'exemple">✕</button>` : ""}
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

  function renderMeasure(measure) {
    dialog.querySelector("#measure").innerHTML = measure
      ? `<span class="hanzi-sm">${escape(measure.hanzi)}</span> ${speakButton(measure.hanzi)}
         <span class="muted">${escape(measure.pinyin)}</span>`
      : '<span class="muted">Aucun classificateur (verbe, adjectif… ou pas encore renseigné).</span>';
  }
  renderMeasure(word.measure);

  const classifierForm = dialog.querySelector("#classifier-form");
  attachKeyboard(classifierForm.elements.classifiers, "hanzi");
  classifierForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const classifiers = classifierForm.elements.classifiers.value.split(/[\s,，、]+/).filter(Boolean);
    if (!classifiers.every((c) => /^[㐀-鿿]{1,2}$/.test(c))) {
      toast("Un classificateur s'écrit avec un ou deux caractères chinois (ex. 本).", "error");
      return;
    }
    try {
      const updated = await api(`/words/${wordId}/classifiers`, { method: "PUT", body: { classifiers } });
      classifierForm.elements.classifiers.value = updated.classifiers.join(" ");
      renderMeasure(updated.measure);
      toast("Classificateurs enregistrés", "success");
      onChange?.();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const exampleForm = dialog.querySelector("#example-form");
  attachKeyboard(exampleForm.elements.hanzi, "hanzi");
  attachKeyboard(exampleForm.elements.pinyin, "pinyin");
  exampleForm.addEventListener("submit", async (e) => {
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

// Mes mots : garder le mot dans sa liste personnelle (révisée comme un exercice) et y noter son
// moyen mnémotechnique.
async function bindMyWord(dialog, word, onChange) {
  const { id: wordId, hanzi } = word;
  const meaning = dialog.querySelector("#my-meaning");
  const toggle = dialog.querySelector("#my-toggle");
  const note = dialog.querySelector("#my-note");
  let mine;
  try {
    mine = await api(`/my-words/${wordId}`);
  } catch {
    dialog.querySelector(".my-word").hidden = true;
    return;
  }
  const render = () => {
    toggle.disabled = false;
    toggle.textContent = mine.in_list ? "✓ Dans Mes mots · retirer" : "＋ Ajouter à Mes mots";
    toggle.setAttribute("aria-pressed", String(mine.in_list));
  };
  note.value = mine.note || "";
  render();
  toggle.addEventListener("click", async () => {
    // Retirer un mot personnel le supprime.
    if (mine.in_list && word.personal
        && !confirm(`${hanzi} est un mot personnel : le retirer le supprime, avec ta progression et ta note. Continuer ?`)) return;
    toggle.disabled = true;
    try {
      await toggleMyWord(wordId, hanzi, mine.in_list);
      if (word.personal && mine.in_list) {
        onChange?.();
        dialog.close();
        return;
      }
      mine.in_list = !mine.in_list;
      onChange?.();
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
    }
    render();
  });
  dialog.querySelector("#my-note-save").addEventListener("click", async () => {
    try {
      if (meaning && meaning.value.trim() && meaning.value.trim() !== word.translation) {
        const edited = await api(`/my-words/${wordId}`, { method: "PATCH", body: { translation: meaning.value.trim() } });
        word.translation = edited.translation;
        dialog.querySelector(".meaning").textContent = edited.translation;
      }
      const saved = await api(`/my-words/${wordId}/note`, { method: "PUT", body: { note: note.value } });
      note.value = saved.note || "";
      toast(saved.note ? "Note enregistrée" : "Note supprimée", "success");
      onChange?.();
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
    }
  });
}

/** Ajoute ou retire un mot de Mes mots (avec un message). */
export async function toggleMyWord(wordId, hanzi, inList) {
  if (inList) {
    await api(`/my-words/${wordId}`, { method: "DELETE" });
    toast(`${hanzi} retiré de Mes mots.`);
  } else {
    await api(`/my-words/${wordId}`, { method: "PUT" });
    toast(`${hanzi} ajouté à Mes mots : il entre dans tes pas du fil.`, "success");
  }
}
