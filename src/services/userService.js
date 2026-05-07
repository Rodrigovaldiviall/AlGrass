const USER_KEY = 'pichanga_user';

export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

export function setUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}
}

export function removeUser() {
  try { localStorage.removeItem(USER_KEY); } catch {}
}
