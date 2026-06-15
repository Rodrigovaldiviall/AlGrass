const LS_KEY = 'pichanga_waitlist_spot';
const EV     = 'waitlist-badge';

// Booleano: "existe una oportunidad activa de reserva en una waitlist del usuario".
// Patrón espejo de notifBadge (localStorage + evento) para TabBar y Sidebar.
export function setWaitlistBadge(has) {
  const v = has ? '1' : '0';
  try { localStorage.setItem(LS_KEY, v); } catch {}
  window.dispatchEvent(new CustomEvent(EV, { detail: !!has }));
}

export function readWaitlistBadge() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
