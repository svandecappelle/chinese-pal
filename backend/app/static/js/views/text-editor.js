import { api, escape } from "../api.js";
import { attachKeyboard } from "../keyboard.js";
import { toast } from "../ui.js";

// Écriture ou modification d'un texte gradué (professeurs et administrateurs). `text` absent :
// nouveau texte. `onSaved(text)` reçoit le texte enregistré.
export function openTextEditor(text, onSaved) {
  const t = text ?? { level: 1, title: "", title_fr: "", text: "", translation: "", hidden: false };
  const dialog = document.createElement("dialog");
  dialog.className = "word-dialog form-dialog text-editor";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Fermer">✕</button></form>
    <h3>${text ? "Modifier le texte" : "Nouveau texte"}</h3>
    <form class="stack" novalidate>
      <div class="row">
        <label class="text-editor-level">Niveau
          <select name="level">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
            `<option value="${n}" ${n === t.level ? "selected" : ""}>HSK ${n}</option>`).join("")}</select>
        </label>
        <label>Titre (chinois)
          <input name="title" required maxlength="60" lang="zh" value="${escape(t.title)}">
        </label>
      </div>
      <label>Titre en français
        <input name="title_fr" maxlength="120" value="${escape(t.title_fr)}">
      </label>
      <label>Texte
        <textarea name="text" required maxlength="3000" rows="6" lang="zh">${escape(t.text)}</textarea>
      </label>
      <label>Traduction
        <textarea name="translation" maxlength="6000" rows="5">${escape(t.translation)}</textarea>
      </label>
      <label class="check"><input type="checkbox" name="hidden" ${t.hidden ? "checked" : ""}>
        Masqué aux élèves <small class="muted">(visible des professeurs seulement)</small></label>
      <p class="error"></p>
      <div class="actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="secondary" data-cancel>Annuler</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form.stack");
  attachKeyboard(form.elements.title, "hanzi");
  attachKeyboard(form.elements.text, "hanzi");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const body = {
      level: Number(form.elements.level.value),
      title: form.elements.title.value.trim(),
      title_fr: form.elements.title_fr.value.trim(),
      text: form.elements.text.value.trim(),
      translation: form.elements.translation.value.trim(),
      hidden: form.elements.hidden.checked,
    };
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const saved = await api(text ? `/texts/${text.id}` : "/texts", { method: text ? "PUT" : "POST", body });
      toast(text ? "Texte enregistré" : "Texte ajouté", "success");
      dialog.close();
      onSaved?.(saved);
    } catch (err) {
      form.querySelector(".error").textContent = err.message;
      button.disabled = false;
    }
  });
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  return dialog;
}

/** Masque un texte aux élèves, ou le rend de nouveau visible. */
export async function setTextHidden(id, hidden) {
  await api(`/texts/${id}/hidden`, { method: "PUT", body: { hidden } });
  toast(hidden ? "Texte masqué aux élèves" : "Texte de nouveau visible des élèves", "success");
}
