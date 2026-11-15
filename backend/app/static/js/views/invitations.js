import { api, escape } from "../api.js";
import { can, displayName, session, setUser } from "../session.js";
import { toast } from "../ui.js";

// Liens d'invitation : un professeur ou un administrateur les crée ; la personne qui ouvre le
// lien crée elle-même son compte (#/invitation/<jeton>) et rejoint les groupes de l'invitation.

const date = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const linkFor = (token) => `${location.origin}${location.pathname}#/invitation/${token}`;
export const canInvite = () => can("manage_users") || can("manage_courses");

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = "Copié ✓";
    setTimeout(() => { button.textContent = label; }, 1500);
  } catch {
    toast("Copie impossible : sélectionne le lien à la main.", "error");
  }
}

function status(inv) {
  if (inv.valid) return `<span class="tag inv-ok">valable jusqu'au ${date(inv.expires_at)}</span>`;
  if (inv.max_uses && inv.uses >= inv.max_uses) return '<span class="tag">complet</span>';
  return '<span class="tag">expiré</span>';
}

const qrUrl = (token) => `/api/invitations/qr?text=${encodeURIComponent(linkFor(token))}`;

/** QR code du lien, à projeter en classe (plein écran) ou à télécharger pour l'imprimer. */
function showQr(inv) {
  const dialog = document.createElement("dialog");
  dialog.className = "word-dialog qr-dialog";
  const title = inv.note || inv.group_names.join(", ") || "Invitation";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Fermer">✕</button></form>
    <h3>${escape(title)}</h3>
    <p class="qr-hint">Scanne ce code avec ton téléphone pour créer ton compte.</p>
    <img class="qr-image" src="${qrUrl(inv.token)}" alt="QR code du lien d'invitation">
    <p class="muted small qr-link">${escape(linkFor(inv.token))}</p>
    <div class="actions center-actions qr-actions">
      ${document.fullscreenEnabled ? '<button type="button" data-fullscreen>Plein écran</button>' : ""}
      <a class="button secondary" href="${qrUrl(inv.token)}" download="invitation-${escape(title).replace(/[^\w-]+/g, "-")}.svg">Télécharger</a>
    </div>`;
  document.body.append(dialog);
  dialog.querySelector("[data-fullscreen]")?.addEventListener("click", () => {
    dialog.requestFullscreen().catch(() => toast("Plein écran impossible ici.", "error"));
  });
  dialog.addEventListener("close", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    dialog.remove();
  });
  dialog.showModal();
}

function invitationCard(inv) {
  const me = session.user;
  const uses = inv.max_uses ? `${inv.uses} / ${inv.max_uses} compte(s)` : `${inv.uses} compte(s)`;
  const accounts = inv.accounts.map((a) => `<span class="tag">${escape(displayName(a))}</span>`).join(" ");
  return `
    <article class="card-box inv-card ${inv.valid ? "" : "inv-expired"}" data-id="${inv.id}">
      <div class="inv-head">
        <strong>${escape(inv.note || inv.group_names.join(", ") || "Sans groupe")}</strong>
        ${status(inv)}
      </div>
      <p class="muted small">
        ${inv.note && inv.group_names.length ? `Groupes : ${inv.group_names.map(escape).join(", ")} · ` : ""}
        ${inv.group_names.length ? "" : "Aucun groupe · "}${uses}
        ${inv.created_by !== me.id ? ` · par ${escape(inv.created_by_name ?? "?")}` : ""}
      </p>
      ${inv.valid ? `
        <div class="inv-link">
          <input readonly value="${escape(linkFor(inv.token))}" aria-label="Lien d'invitation">
          <button type="button" class="secondary" data-copy>Copier</button>
          ${navigator.share ? '<button type="button" class="secondary" data-share>Partager</button>' : ""}
          <button type="button" class="secondary" data-qr title="QR code à projeter ou imprimer">QR code</button>
        </div>` : ""}
      ${accounts ? `<p class="small inv-accounts">Inscrits : ${accounts}</p>` : ""}
      <div class="inv-foot">
        <button type="button" class="link" data-revoke>${inv.valid ? "Révoquer le lien" : "Supprimer"}</button>
      </div>
    </article>`;
}

export async function invitationsView(el) {
  if (!canInvite()) {
    el.innerHTML = `<div class="empty"><p>Seuls les professeurs et les administrateurs invitent.</p>
      <p><a href="#/">Retour à l'accueil</a></p></div>`;
    return;
  }
  const manager = can("manage_users");
  const [allGroups, initial] = await Promise.all([api("/admin/groups"), api("/invitations")]);
  let invitations = initial;
  // Un professeur invite dans les classes (groupes sans droits) ; un gestionnaire, partout.
  const groups = allGroups.filter((g) => manager || !g.permissions.length);

  el.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Liens d'invitation</h2>
        <p class="muted small">Envoie un lien : la personne crée elle-même son compte et rejoint les groupes choisis.</p>
      </div>
    </div>
    <div class="inv-layout">
      <section class="card-box">
        <h3>Nouveau lien</h3>
        <form id="inv-form" class="stack">
          <label>Note <small class="muted">(pour t'y retrouver, ex. « 3e B »)</small>
            <input name="note" maxlength="120" placeholder="facultatif">
          </label>
          <fieldset>
            <legend>Groupes rejoints</legend>
            <div class="chips">
              ${groups.map((g) => `
                <label class="chip">
                  <input type="checkbox" name="group" value="${g.id}">
                  ${escape(g.name)}
                  ${g.permissions.length ? '<span class="muted small">donne des droits</span>' : ""}
                </label>`).join("") || '<span class="muted small">Aucun groupe disponible.</span>'}
            </div>
          </fieldset>
          <div class="row">
            <label>Valable
              <select name="days">
                <option value="1">1 jour</option>
                <option value="7">1 semaine</option>
                <option value="14" selected>2 semaines</option>
                <option value="30">1 mois</option>
                <option value="90">3 mois</option>
              </select>
            </label>
            <label>Comptes au plus
              <input name="max_uses" type="number" min="1" max="1000" placeholder="sans limite">
            </label>
          </div>
          <button type="submit">Créer le lien</button>
        </form>
      </section>
      <section>
        <h3 class="inv-list-title">${manager ? "Tous les liens" : "Mes liens"}</h3>
        <div id="inv-list" class="inv-list"></div>
      </section>
    </div>`;

  const list = el.querySelector("#inv-list");
  const render = () => {
    list.innerHTML = invitations.map(invitationCard).join("")
      || '<p class="muted">Aucun lien pour l’instant.</p>';
  };
  render();

  const form = el.querySelector("#inv-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const maxUses = form.elements.max_uses.value;
      const created = await api("/invitations", {
        method: "POST",
        body: {
          note: form.elements.note.value.trim(),
          group_ids: [...form.querySelectorAll("input[name=group]:checked")].map((i) => Number(i.value)),
          days: Number(form.elements.days.value),
          max_uses: maxUses ? Number(maxUses) : null,
        },
      });
      invitations = [created, ...invitations];
      render();
      form.reset();
      toast("Lien créé : copie-le et envoie-le.", "success");
      list.querySelector(`[data-id="${created.id}"] input`)?.select();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  list.addEventListener("click", async (e) => {
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const inv = invitations.find((i) => i.id === Number(card.dataset.id));
    if (e.target.closest("[data-copy]")) {
      copy(linkFor(inv.token), e.target.closest("[data-copy]"));
    } else if (e.target.closest("[data-qr]")) {
      showQr(inv);
    } else if (e.target.closest("[data-share]")) {
      navigator.share({ title: "Invitation", text: "Crée ton compte pour réviser le chinois :",
                        url: linkFor(inv.token) }).catch(() => {});
    } else if (e.target.closest("[data-revoke]")) {
      if (inv.valid && !confirm("Révoquer ce lien ? Il ne marchera plus ; les comptes déjà créés restent.")) return;
      try {
        await api(`/invitations/${inv.id}`, { method: "DELETE" });
        invitations = invitations.filter((i) => i.id !== inv.id);
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });
  list.addEventListener("focusin", (e) => {
    if (e.target.matches(".inv-link input")) e.target.select();
  });
}

/** Page ouverte par la personne invitée : elle crée son compte. */
export async function signupView(el, { token }) {
  let info;
  try {
    info = await api(`/invitations/${encodeURIComponent(token)}/info`);
  } catch (err) {
    el.innerHTML = `<div class="auth-card"><h2>Invitation</h2><p class="error">${escape(err.message)}</p>
      <p class="muted small">Tu as déjà un compte ? <a href="#/connexion">Connecte-toi</a>.</p></div>`;
    return;
  }
  const groups = info.groups.length ? ` et rejoindre <strong>${info.groups.map(escape).join(", ")}</strong>` : "";
  el.innerHTML = `
    <div class="auth-card">
      <h2>Créer mon compte</h2>
      <p><strong>${escape(info.created_by_name)}</strong> t'invite à réviser le chinois${groups}.</p>
      ${session.user ? `
        <p class="notice small">Tu es connecté avec le compte <strong>${escape(displayName(session.user))}</strong>.
          Le nouveau compte remplacera cette connexion sur cet appareil.</p>` : ""}
      ${session.guest ? '<p class="muted small">Ce que tu as déjà révisé sans compte sera gardé dans ton nouveau compte.</p>' : ""}
      <form id="signup-form" class="stack">
        <label>Identifiant <small class="muted">(pour te connecter : lettres, chiffres, . - _)</small>
          <input name="username" required pattern="[a-zA-Z0-9._\\-]{2,40}" autocomplete="username"
            autocapitalize="none" spellcheck="false" title="2 à 40 lettres, chiffres, point, tiret ou souligné">
        </label>
        <label>Nom affiché <small class="muted">(facultatif, ex. ton prénom)</small>
          <input name="display_name" maxlength="80" autocomplete="nickname">
        </label>
        <label>Mot de passe <small class="muted">(8 caractères au moins)</small>
          <input name="password" type="password" minlength="8" required autocomplete="new-password">
        </label>
        <label>Confirmation
          <input name="confirm" type="password" minlength="8" required autocomplete="new-password">
        </label>
        <p id="signup-error" class="error" role="alert"></p>
        <button type="submit">Créer mon compte</button>
      </form>
      <p class="muted small center">Lien valable jusqu'au ${date(info.expires_at)}.
        Déjà un compte ? <a href="#/connexion">Connecte-toi</a>.</p>
    </div>`;

  const form = el.querySelector("#signup-form");
  const error = el.querySelector("#signup-error");
  form.elements.username.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    error.textContent = "";
    if (f.password.value !== f.confirm.value) {
      error.textContent = "Les deux mots de passe ne sont pas identiques.";
      f.confirm.focus();
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const { user } = await api(`/invitations/${encodeURIComponent(token)}/signup`, {
        method: "POST",
        body: { username: f.username.value.trim(), display_name: f.display_name.value.trim(), password: f.password.value },
      });
      setUser(user);
      toast(`Bienvenue ${displayName(user)} !`, "success");
      location.hash = "#/";
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}
