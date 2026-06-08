// Source of truth for all notification templates.
// body strings are static for now — interpolation (params) added in v2.
// imageType: 'venue_image' | 'algrass_logo'

export const notificationTemplates = {

  // ── Onboarding ─────────────────────────────────────────────────────────────

  welcome_message: {
    title:       'Bienvenido a Algrass',
    body:        'Ya puedes explorar partidos y reservar canchas cerca de ti.',
    sourceLabel: 'Algrass',
    imageType:   'algrass_logo',
  },

  // ── Reservations ───────────────────────────────────────────────────────────

  reservation_confirmed: {
    title:       'Reserva confirmada',
    body:        'Tu reserva ha sido confirmada. ¡Hasta la cancha!',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  reservation_confirmed_with_guests: {
    title:       'Reserva confirmada',
    body:        'Tu reserva incluye invitados. Recuérdales la hora y lugar.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  guest_reservation_confirmed: {
    title:       'Estás en el partido',
    body:        'Tu lugar fue confirmado. Revisa los detalles antes de ir.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  invited_by_player: {
    title:       'Te invitaron a un partido',
    body:        'Un jugador reservó tu lugar. Revisa los detalles.',
    sourceLabel: 'Invitación',
    imageType:   'venue_image',
  },

  // ── Waitlist ───────────────────────────────────────────────────────────────

  waitlist_spot_available: {
    title:       'Partido disponible',
    body:        'Se ha abierto un cupo para ti. Aprovecha y reserva ahora.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  // ── Cancellations & credits ────────────────────────────────────────────────

  reservation_cancelled_credit_self: {
    title:       'Reserva cancelada',
    body:        'Cancelaste tu reserva. El crédito fue añadido a tu billetera.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  reservation_cancelled_credit_owner: {
    title:       'Cancelaste tu invitación',
    body:        'Cancelaste la reserva. El crédito fue devuelto al titular.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  guest_invitation_cancelled_credit: {
    title:       'Invitación cancelada',
    body:        'La invitación fue cancelada. El crédito fue añadido a tu billetera.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  reservation_cancelled_guests_credit: {
    title:       'Reserva cancelada',
    body:        'Cancelaste la reserva de tu/s invitado/s. El crédito fue añadido a tu billetera.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  reservation_cancelled_self_and_guests: {
    title:       'Reserva cancelada',
    body:        'Cancelaste tu reserva y la de tu/s invitado/s. El crédito fue añadido a tu billetera.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  guest_invitation_cancelled_by_owner: {
    title:       'Invitación cancelada',
    body:        'El titular ha cancelado tu invitación.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  // ── Logistics ──────────────────────────────────────────────────────────────

  venue_changed: {
    title:       'La cancha cambió',
    body:        'El organizador cambió el lugar del partido. Revisa la nueva ubicación.',
    sourceLabel: 'Tu partido',
    imageType:   'venue_image',
  },

  // ── Reminders ──────────────────────────────────────────────────────────────

  next_day_reminder: {
    title:       'Mañana tienes partido',
    body:        'No olvides tu equipamiento. ¡Nos vemos mañana!',
    sourceLabel: 'Recordatorio',
    imageType:   'venue_image',
  },

  same_day_reminder: {
    title:       'Hoy tienes partido',
    body:        'Tu partido es hoy. Recuerda llegar 10 minutos antes.',
    sourceLabel: 'Recordatorio',
    imageType:   'venue_image',
  },

  // ── Cancellations by force ─────────────────────────────────────────────────

  weather_cancellation: {
    title:       'Partido cancelado por lluvia',
    body:        'El partido fue cancelado por condiciones climáticas. Tu crédito ya está disponible.',
    sourceLabel: 'Algrass',
    imageType:   'algrass_logo',
  },

  force_majeure_cancellation: {
    title:       'Partido cancelado',
    body:        'El partido fue cancelado por causas de fuerza mayor. Tu crédito ya está disponible.',
    sourceLabel: 'Algrass',
    imageType:   'algrass_logo',
  },

  // ── Broadcasts ─────────────────────────────────────────────────────────────

  new_venue_opened: {
    title:       'Nueva cancha disponible',
    body:        'Hay una nueva cancha cerca de ti. ¡Échale un vistazo!',
    sourceLabel: 'Algrass',
    imageType:   'venue_image',
  },

  rain_policy_broadcast: {
    title:       'Política de lluvia',
    body:        'Recuerda que los partidos se realizan salvo lluvia intensa. Sigue las actualizaciones del organizador.',
    sourceLabel: 'Algrass',
    imageType:   'algrass_logo',
  },
};

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = (t || '').split(':').map(Number);
  if (isNaN(h)) return null;
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Renderer central — único punto de cambio cuando llegue interpolación v2.
// Uso: renderNotification(row) → { title, body, sourceLabel, imageType }
export function renderNotification(row) {
  const tpl = notificationTemplates[row.template_key];
  if (!tpl) return null;
  const body      = row.custom_text ?? tpl.body;
  const venueName = row.games?.fields?.venues?.name ?? null;
  const gameTime  = fmtTime(row.games?.time);
  const prefix    = [gameTime, venueName].filter(Boolean).join(' · ');
  return { ...tpl, body: prefix ? `${prefix}. ${body}` : body };
}
