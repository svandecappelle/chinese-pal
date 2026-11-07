import { api, escape } from "../api.js";
import { displayName, session } from "../session.js";
import { remember, save, toast } from "../ui.js";

const STATE_KEY = "chinese.admin";

const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";

/** Boîte de dialogue avec un formulaire ; `onSubmit(form)` renvoie true pour fermer. */
function formDialog(title, body, submitLabel, onSubmit) {
  const dialog = document.createElement("dialog");
  dialog.className = "word-dialog form-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Fermer">✕</button></form>
    <h3>${title}</h3>
    <form class="stack" novalidate>
      ${body}
      <p class="error" role="alert"></p>
      <div class="actions">
        <button type="submit">${submitLabel}</button>
        <button type="button" class="secondary" data-cancel>Annuler</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form.stack");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    try {
      if (await onSubmit(form)) dialog.close();
    } catch (err) {
      form.querySelector(".error").textContent = err.message;
    }
  });
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  form.querySelector("input:not([type=checkbox])")?.focus();
  return dialog;
}

/** Affiche un mot de passe généré, qui ne sera plus jamais lisible. */
function showPassword(username, password) {
  const dialog = document.createElement("dialog");
  dialog.className = "word-dialog form-dialog";
  dialog.innerHTML = `
    <h3>Mot de passe de « ${escape(username)} »</h3>
    <p>Transmets-le à la personne : il ne sera plus affiché. Elle pourra le changer depuis « Mon compte ».</p>
    <div class="password-box">
      <code>${escape(password)}</code>
      <button type="button" class="secondary" data-copy>Copier</button>
    </div>
    <div class="actions"><button type="button" data-close>J'ai noté le mot de passe</button></div>`;
  document.body.append(dialog);
  dialog.querySelector("[data-copy]").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(password);
      e.target.textContent = "Copié ✓";
    } catch {
      toast("Copie impossible : sélectionne le mot de passe à la main.", "error");
    }
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

export async function adminView(el) {
  const state = remember(STATE_KEY, { tab: "users" });
  let users = [];
  let groups = [];
  const me = session.user;

  el.innerHTML = `
    <div class="toolbar">
      <h2>Administration</h2>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="users">Comptes</button>
        <button type="button" role="tab" data-tab="groups">Groupes</button>
      </div>
    </div>
    <div id="tab-content"></div>`;

  const content = el.querySelector("#tab-content");
  const groupName = (id) => groups.find((g) => g.id === id)?.name ?? "?";

  function groupChecks(selected) {
    return groups.map((g) => `
      <label class="chip">
        <input type="checkbox" name="group" value="${g.id}" ${selected.includes(g.id) ? "checked" : ""}>
        ${escape(g.name)}
        ${g.permissions.length ? `<span class="muted small">${g.permissions.length} droit(s)</span>` : ""}
      </label>`).join("") || '<p class="muted small">Aucun groupe.</p>';
  }

  const checked = (form, name) =>
    [...form.querySelectorAll(`input[name=${name}]:checked`)].map((i) => Number(i.value) || i.value);

  // ------------------------------------------------------------ comptes

  function renderUsers() {
    content.innerHTML = `
      <div class="toolbar">
        <p class="muted small">${users.length} compte(s). Les droits viennent des groupes ; un administrateur a tous les droits.</p>
        <button type="button" id="new-user">+ Nouveau compte</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Compte</th><th>Groupes</th><th class="hide-narrow">Dernière connexion</th><th class="actions-col"></th>
          </tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr class="${u.active ? "" : "inactive"}">
                <td>
                  <strong>${escape(displayName(u))}</strong>
                  ${u.display_name ? `<div class="muted small">${escape(u.username)}</div>` : ""}
                  ${u.is_admin ? '<span class="tag role">administrateur</span>' : ""}
                  ${u.active ? "" : '<span class="tag">désactivé</span>'}
                </td>
                <td>${u.group_ids.map((id) => `<span class="tag">${escape(groupName(id))}</span>`).join(" ")
                  || '<span class="muted small">aucun</span>'}</td>
                <td class="hide-narrow muted small">${dateTime(u.last_login_at)}</td>
                <td class="actions-col nowrap">
                  <button type="button" class="link" data-edit-user="${u.id}" title="Modifier" aria-label="Modifier ${escape(u.username)}">✎</button>
                  <button type="button" class="link" data-reset="${u.id}" title="Nouveau mot de passe" aria-label="Nouveau mot de passe pour ${escape(u.username)}">🔑</button>
                  ${u.id === me.id ? "" : `<button type="button" class="link" data-delete-user="${u.id}" title="Supprimer" aria-label="Supprimer ${escape(u.username)}">✕</button>`}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function userForm(user) {
    const self = user?.id === me.id;
    const adminLocked = !me.is_admin || self;
    return `
      <div class="row">
        <label>Identifiant
          <input name="username" required pattern="[a-zA-Z0-9._\\-]{2,40}" autocapitalize="none" spellcheck="false"
            value="${escape(user?.username ?? "")}" title="2 à 40 lettres, chiffres, point, tiret ou souligné">
        </label>
        <label>Nom affiché
          <input name="display_name" maxlength="80" value="${escape(user?.display_name ?? "")}" placeholder="facultatif">
        </label>
      </div>
      ${user ? "" : `
        <label>Mot de passe <small class="muted">(vide : généré et affiché une fois)</small>
          <input name="password" type="text" minlength="8" autocomplete="off" spellcheck="false">
        </label>`}
      <fieldset>
        <legend>Groupes</legend>
        <div class="chips">${groupChecks(user?.group_ids ?? [])}</div>
      </fieldset>
      <label class="check">
        <input type="checkbox" name="is_admin" ${user?.is_admin ? "checked" : ""} ${adminLocked ? "disabled" : ""}>
        Administrateur (tous les droits)
      </label>
      <label class="check">
        <input type="checkbox" name="active" ${user?.active ?? true ? "checked" : ""} ${self ? "disabled" : ""}>
        Compte actif (décoché : connexion impossible, progression conservée)
      </label>`;
  }

  function userBody(form) {
    return {
      username: form.elements.username.value.trim(),
      display_name: form.elements.display_name.value.trim(),
      is_admin: form.elements.is_admin.checked,
      active: form.elements.active.checked,
      group_ids: checked(form, "group"),
    };
  }

  function newUser() {
    formDialog("Nouveau compte", userForm(null), "Créer", async (form) => {
      const created = await api("/admin/users", {
        method: "POST",
        body: { ...userBody(form), password: form.elements.password.value },
      });
      users.push(created);
      users.sort((a, b) => a.username.localeCompare(b.username));
      await reloadGroups();
      renderUsers();
      toast(`Compte « ${created.username} » créé`, "success");
      if (created.password) showPassword(created.username, created.password);
      return true;
    });
  }

  function editUser(user) {
    formDialog(`Modifier « ${escape(user.username)} »`, userForm(user), "Enregistrer", async (form) => {
      const updated = await api(`/admin/users/${user.id}`, { method: "PUT", body: userBody(form) });
      users[users.findIndex((u) => u.id === user.id)] = updated;
      await reloadGroups();
      renderUsers();
      toast("Compte enregistré", "success");
      return true;
    });
  }

  // ------------------------------------------------------------ groupes

  function renderGroups() {
    content.innerHTML = `
      <div class="toolbar">
        <p class="muted small">Un groupe est à la fois une classe (on lui attribue des exercices) et un ensemble de droits.</p>
        <button type="button" id="new-group">+ Nouveau groupe</button>
      </div>
      <div class="grid">
        ${groups.map((g) => `
          <article class="exercise">
            <h3>${escape(g.name)}</h3>
            ${g.description ? `<p class="muted small">${escape(g.description)}</p>` : ""}
            <p class="tags">${g.permissions.map((p) => `<span class="tag role">${escape(session.permissions[p])}</span>`).join("")
              || '<span class="muted small">Aucun droit particulier : révision seulement</span>'}</p>
            <p class="small">${g.member_ids.length} membre(s)${g.member_ids.length
              ? ` : <span class="muted">${g.member_ids.slice(0, 6).map((id) => escape(displayName(users.find((u) => u.id === id) ?? { username: "?" }))).join(", ")}${g.member_ids.length > 6 ? "…" : ""}</span>`
              : ""}</p>
            <div class="actions">
              <button type="button" class="secondary" data-edit-group="${g.id}">Modifier</button>
              <button type="button" class="link" data-delete-group="${g.id}" title="Supprimer le groupe">Supprimer</button>
            </div>
          </article>`).join("") || '<div class="empty"><p>Aucun groupe.</p></div>'}
      </div>`;
  }

  function groupForm(group) {
    const members = new Set(group?.member_ids ?? []);
    return `
      <label>Nom
        <input name="name" required maxlength="80" value="${escape(group?.name ?? "")}" placeholder="ex. Classe de 2nde B">
      </label>
      <label>Description
        <input name="description" maxlength="300" value="${escape(group?.description ?? "")}" placeholder="facultatif">
      </label>
      <fieldset>
        <legend>Droits des membres</legend>
        ${Object.entries(session.permissions).map(([key, label]) => `
          <label class="check">
            <input type="checkbox" name="permission" value="${key}" ${group?.permissions.includes(key) ? "checked" : ""}>
            ${escape(label)}
          </label>`).join("")}
        <p class="muted small">Sans droit coché, les membres révisent les exercices attribués au groupe.</p>
      </fieldset>
      <fieldset>
        <legend>Membres <span class="muted small" data-member-count></span></legend>
        <input type="search" data-member-filter placeholder="Filtrer les comptes…" aria-label="Filtrer les comptes">
        <div class="member-list">
          ${users.map((u) => `
            <label class="check" data-member-label="${escape(`${u.username} ${u.display_name}`.toLowerCase())}">
              <input type="checkbox" name="member" value="${u.id}" ${members.has(u.id) ? "checked" : ""}>
              ${escape(displayName(u))} <span class="muted small">${u.display_name ? escape(u.username) : ""}</span>
            </label>`).join("")}
        </div>
      </fieldset>`;
  }

  function bindMemberFilter(dialog) {
    const count = () => {
      dialog.querySelector("[data-member-count]").textContent =
        `(${dialog.querySelectorAll("input[name=member]:checked").length})`;
    };
    count();
    dialog.addEventListener("change", count);
    dialog.querySelector("[data-member-filter]").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      dialog.querySelectorAll("[data-member-label]").forEach((label) => {
        label.hidden = q && !label.dataset.memberLabel.includes(q);
      });
    });
  }

  function groupBody(form) {
    return {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim() || null,
      permissions: checked(form, "permission"),
      member_ids: checked(form, "member"),
    };
  }

  function editGroup(group) {
    const dialog = formDialog(group ? `Modifier « ${escape(group.name)} »` : "Nouveau groupe", groupForm(group),
      group ? "Enregistrer" : "Créer", async (form) => {
        const saved = await api(group ? `/admin/groups/${group.id}` : "/admin/groups", {
          method: group ? "PUT" : "POST",
          body: groupBody(form),
        });
        await reload();
        toast(`Groupe « ${saved.name} » enregistré`, "success");
        return true;
      });
    bindMemberFilter(dialog);
  }

  // ------------------------------------------------------------ chargement et actions

  async function reloadGroups() {
    groups = await api("/admin/groups");
  }

  async function reload() {
    [users, groups] = await Promise.all([api("/admin/users"), api("/admin/groups")]);
    renderTab();
  }

  function renderTab() {
    save(STATE_KEY, state);
    el.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === state.tab);
      b.setAttribute("aria-selected", b.dataset.tab === state.tab);
    });
    state.tab === "groups" ? renderGroups() : renderUsers();
  }

  el.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    state.tab = tab.dataset.tab;
    renderTab();
  });

  content.addEventListener("click", async (e) => {
    const target = e.target.closest("button");
    if (!target) return;
    const find = (list, key) => list.find((x) => x.id === Number(target.dataset[key]));
    try {
      if (target.id === "new-user") newUser();
      else if (target.id === "new-group") editGroup(null);
      else if (target.dataset.editUser) editUser(find(users, "editUser"));
      else if (target.dataset.editGroup) editGroup(find(groups, "editGroup"));
      else if (target.dataset.reset) {
        const user = find(users, "reset");
        if (!confirm(`Générer un nouveau mot de passe pour « ${user.username} » ? L'ancien ne fonctionnera plus.`)) return;
        const { password } = await api(`/admin/users/${user.id}/password`, { method: "POST" });
        showPassword(user.username, password);
      } else if (target.dataset.deleteUser) {
        const user = find(users, "deleteUser");
        if (!confirm(`Supprimer le compte « ${user.username} » et toute sa progression ? `
          + "(Pour seulement bloquer la connexion, désactive-le plutôt.)")) return;
        await api(`/admin/users/${user.id}`, { method: "DELETE" });
        toast(`Compte « ${user.username} » supprimé`);
        await reload();
      } else if (target.dataset.deleteGroup) {
        const group = find(groups, "deleteGroup");
        if (!confirm(`Supprimer le groupe « ${group.name} » ? Ses membres perdent les droits et les exercices qu'il leur donnait.`)) return;
        await api(`/admin/groups/${group.id}`, { method: "DELETE" });
        toast(`Groupe « ${group.name} » supprimé`);
        await reload();
      }
    } catch (err) {
      toast(err.message, "error");
    }
  });

  await reload();
}
