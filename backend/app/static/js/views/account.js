import { api, escape } from "../api.js";
import { session, setUser } from "../session.js";
import { toast } from "../ui.js";

export async function accountView(el) {
  const user = session.user;
  const groups = user.permissions.length
    ? user.permissions.map((p) => `<li>${escape(session.permissions[p])}</li>`).join("")
    : "<li>Réviser les exercices qui te sont attribués</li>";

  el.innerHTML = `
    <h2>Mon compte</h2>
    <div class="account-grid">
      <section class="card-box">
        <h3>Profil</h3>
        <p class="muted small">Identifiant : <strong>${escape(user.username)}</strong>
          ${user.is_admin ? '<span class="tag">administrateur</span>' : ""}</p>
        <form id="profile-form" class="stack">
          <label>Nom affiché
            <input name="display_name" maxlength="80" value="${escape(user.display_name)}"
              placeholder="${escape(user.username)}">
          </label>
          <button type="submit" class="secondary">Enregistrer</button>
        </form>
        <h3>Ce que tu peux faire</h3>
        <ul class="small">${groups}</ul>
      </section>

      <section class="card-box">
        <h3>Changer de mot de passe</h3>
        <form id="password-form" class="stack">
          <label>Mot de passe actuel
            <input name="current" type="password" autocomplete="current-password" required>
          </label>
          <label>Nouveau mot de passe <small class="muted">(8 caractères au moins)</small>
            <input name="new" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <label>Confirmation
            <input name="confirm" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <button type="submit">Changer le mot de passe</button>
          <p class="muted small">Tes autres appareils seront déconnectés.</p>
        </form>
      </section>
    </div>`;

  el.querySelector("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const updated = await api("/account/profile", {
        method: "PUT",
        body: { display_name: e.target.elements.display_name.value },
      });
      setUser(updated);
      toast("Profil enregistré", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  el.querySelector("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.new.value !== f.confirm.value) {
      toast("Les deux nouveaux mots de passe ne sont pas identiques.", "error");
      f.confirm.focus();
      return;
    }
    try {
      await api("/account/password", { method: "PUT", body: { current: f.current.value, new: f.new.value } });
      e.target.reset();
      toast("Mot de passe changé", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}
