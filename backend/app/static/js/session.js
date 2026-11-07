import { api } from "./api.js";

// Utilisateur connecté, partagé par toutes les vues. `user` vaut null sans connexion.
export const session = { user: null, permissions: {} };

export async function loadSession() {
  const data = await api("/account");
  session.user = data.user;
  session.permissions = data.permissions;
  return session.user;
}

export function setUser(user) {
  session.user = user;
  window.dispatchEvent(new Event("session-change"));
}

/** Droit de l'utilisateur connecté : manage_vocab, manage_courses, manage_users. */
export const can = (permission) => Boolean(session.user?.permissions.includes(permission));

export const displayName = (user) => user.display_name || user.username;
