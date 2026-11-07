import { api } from "./api.js";
import { clearApiCache } from "./offline.js";

// Utilisateur connecté, partagé par toutes les vues. `user` vaut null sans connexion.
// `guest` : sans compte, mais une progression d'invité existe dans ce navigateur.
export const session = { user: null, guest: false, permissions: {} };

export async function loadSession() {
  const data = await api("/account");
  session.user = data.user;
  session.guest = data.guest;
  session.permissions = data.permissions;
  return session.user;
}

export function setUser(user) {
  session.user = user;
  // Réponses de l'API gardées pour le hors ligne : celles de l'ancien compte ne restent pas.
  clearApiCache();
  // Connexion : la progression d'invité a rejoint le compte. Déconnexion : plus de cookie.
  session.guest = false;
  window.dispatchEvent(new Event("session-change"));
}

/** Droit de l'utilisateur connecté : manage_vocab, manage_courses, manage_users. */
export const can = (permission) => Boolean(session.user?.permissions.includes(permission));

export const displayName = (user) => user.display_name || user.username;
