const LS_KEY = 'pichanga_notif_unread';
const EV     = 'notif-badge';

export function setNotifBadge(count) {
  const n = count || 0;
  try { localStorage.setItem(LS_KEY, String(n)); } catch {}
  window.dispatchEvent(new CustomEvent(EV, { detail: n }));
}

export function readNotifBadgeLabel() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) return undefined;
    const n = parseInt(raw, 10);
    if (!n || n === 0) return undefined;
    return n >= 5 ? '5+' : n;
  } catch { return undefined; }
}

export function badgeLabel(n) {
  if (!n || n === 0) return undefined;
  return n >= 5 ? '5+' : n;
}

export function getNotifCount() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) return 0;
    return Math.max(0, parseInt(raw, 10) || 0);
  } catch { return 0; }
}
