const RESERVATIONS_KEY = 'pichanga_reservations';
const CREDIT_KEY       = 'pichanga_credit';
const PAID_KEY         = 'pichanga_paid_players';

export async function getReservations() {
  try { const v = JSON.parse(localStorage.getItem(RESERVATIONS_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function setReservations(reservations) {
  try { localStorage.setItem(RESERVATIONS_KEY, JSON.stringify(reservations)); } catch {}
}

export async function getCredit() {
  try { return JSON.parse(localStorage.getItem(CREDIT_KEY)) || { balance: 0, transactions: [] }; } catch { return { balance: 0, transactions: [] }; }
}

export async function setCredit(credit) {
  try { localStorage.setItem(CREDIT_KEY, JSON.stringify(credit)); } catch {}
}

export async function getPaidStatus() {
  try { const v = JSON.parse(localStorage.getItem(PAID_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function setPaidStatus(data) {
  try { localStorage.setItem(PAID_KEY, JSON.stringify(data)); } catch {}
}
