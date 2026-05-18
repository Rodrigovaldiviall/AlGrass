export const TIMEZONE = 'America/Lima'; // UTC-5, no DST

// Pure UTC epoch comparison — no timezone conversion needed for "has this moment passed?"
export function isExpiredPeru(expiresAt) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= Date.now();
}

// Use { timeZone } only in the format call — never re-parse the resulting string as a Date.
export function formatPeruDate(utcTs, opts = { day: 'numeric', month: 'long' }) {
  return new Date(utcTs).toLocaleDateString('es-PE', { timeZone: TIMEZONE, ...opts });
}

export function formatPeruTime(utcTs) {
  return new Date(utcTs).toLocaleTimeString('es-PE', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
}

// Construct a UTC Date from a Lima wall-clock date+time using the fixed -05:00 offset.
export function parsePeruDateTime(dateKey, time24) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute]     = time24.split(':').map(Number);
  const peruIso = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute ?? 0).padStart(2,'0')}:00-05:00`;
  return new Date(peruIso);
}
