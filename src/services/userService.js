const USER_KEY = 'pichanga_user';

export async function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

export async function setUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}
}

export async function removeUser() {
  try { localStorage.removeItem(USER_KEY); } catch {}
}
