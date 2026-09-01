export const BLUE = '#3F5FE0';
export const TEXT = '#1B1B1F';
export const SUB = '#6B6B70';
export const HAIR = '#E5E5EA';
export const RED = '#E53935';
export const GREEN = '#2E9E5B';
export const ORANGE = '#F5A524';
export const TAB_INACTIVE = '#9A9AA0';
export const SOFT = '#F2F2F4';
export const DANGER = '#E5484D';
export const YAPE = '#742EAB';

// Copy ÚNICO de "game no disponible" (estado no reservable/iniciado) — compartido por
// GameDetail (Match-only) y ConfirmReservation (Match/Rental). CTA sale a la LISTA.
export function gameUnavailableCopy(isRental = false) {
  return isRental
    ? { title: 'Cancha no disponible',  message: 'Durante el proceso, esta cancha dejó de estar disponible para reservar. Vuelve a canchas para seguir explorando.',  cta: 'Volver a canchas',  path: '/fields' }
    : { title: 'Partido no disponible', message: 'Durante el proceso, este partido dejó de estar disponible para reservar. Vuelve a partidos para seguir explorando.', cta: 'Volver a partidos', path: '/games' };
}

// Organizer / support contact — replace with values from admin config when available
export const WHATSAPP_NUMBER  = '51999999999';
export const WHATSAPP_DISPLAY = '+51 999 999 999';
export const SUPPORT_EMAIL    = 'soporte@algrass.com';
