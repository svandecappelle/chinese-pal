import { api } from "../api.js";
import { session, setUser } from "../session.js";

export async function loginView(el) {
  if (session.user) {
    location.hash = "#/";
    return;
  }
  el.innerHTML = `
    <div class="auth-card">
      <h2>Connexion</h2>
      <p class="muted small">Les comptes sont créés par l'administrateur ou le professeur.</p>
      <form id="login-form" class="stack">
        <label>Identifiant
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </label>
        <label>Mot de passe
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <p id="login-error" class="error" role="alert"></p>
        <button type="submit">Se connecter</button>
      </form>
      <p class="muted small center">Sans compte, tu peux
        <a href="#/vocabulaire">parcourir le vocabulaire</a>.</p>
    </div>`;

  const form = el.querySelector("#login-form");
  form.elements.username.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const { user } = await api("/account/login", {
        method: "POST",
        body: { username: form.elements.username.value.trim(), password: form.elements.password.value },
      });
      setUser(user);
      const next = sessionStorage.getItem("chinese.next");
      sessionStorage.removeItem("chinese.next");
      location.hash = `#${next && next !== "/connexion" ? next : "/"}`;
    } catch (err) {
      el.querySelector("#login-error").textContent = err.message;
      form.elements.password.select();
    } finally {
      button.disabled = false;
    }
  });
}
