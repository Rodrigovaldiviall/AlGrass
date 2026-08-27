import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, SOFT, ORANGE } from '../constants';
import TabBar from '../components/TabBar';
import { useForegroundTick } from '../hooks/useForegroundTick';
import I from '../icons';
import fieldImg from '../assets/cancha.jpg';
import algrassLogo from '../assets/logo.webp';
import { useAuth } from '../context/AuthContext';
import { useStaff } from '../context/StaffContext';
import { supabase } from '../lib/supabase';
import { renderNotification } from '../data/notificationTemplates';
import { setNotifBadge, getNotifCount } from '../utils/notifBadge';
import { isGamePast } from '../utils/deriveGameState';
import { getVisibleBottom } from '../utils/layout';

const LONG_MSG  = 100;
const PAGE_SIZE = 20;
const NOTIF_SELECT = 'id, template_key, custom_text, game_id, reservation_id, read_at, created_at, games:game_id(date_key, time, duration_min, fields:field_id(venues:venue_id(name)))';

// Plantillas de cancelación asociadas a cada tipo de notificación navegable.
// El algoritmo de handlePress es único para todas; lo único que varía es este mapeo.
const CANCELLATION_TEMPLATES = {
  invited_by_player:                 ['guest_invitation_cancelled_by_owner', 'reservation_cancelled_credit_owner'],
  reservation_confirmed:             ['reservation_cancelled_credit_self', 'reservation_cancelled_self_and_guests', 'reservation_cancelled_guests_credit', 'reservation_cancelled_no_refund', 'reservation_cancelled_credit_partial'],
  reservation_confirmed_with_guests: ['reservation_cancelled_credit_self', 'reservation_cancelled_self_and_guests', 'reservation_cancelled_guests_credit', 'reservation_cancelled_no_refund', 'reservation_cancelled_credit_partial'],
};

// Cancelaciones de la PROPIA reserva/participación del usuario (Match titular self, invitado
// que cancela su plaza, self+invitados, y Rental). Identificación ESTRUCTURADA por template_key
// (sin leer custom_text). NO incluye reservation_cancelled_guests_credit ni guest_invitation_*
// (cancelación de/para invitados), que deben seguir sin navegación.
const OWN_CANCELLATION_TEMPLATES = [
  'reservation_cancelled_credit_self',
  'reservation_cancelled_no_refund',
  'reservation_cancelled_credit_partial',
  'reservation_cancelled_credit_owner',
  'reservation_cancelled_self_and_guests',
];
// Notificaciones de reserva/confirmación original (llevan reservation_id). invited_by_player se
// EXCLUYE a propósito: no guarda reservation_id → correlación por ciclo imposible (limitación
// ya auditada y aceptada).
const ORIGINAL_CONFIRMATION_TEMPLATES = ['reservation_confirmed', 'reservation_confirmed_with_guests'];
// Notificación ORIGINAL de invitación recibida por el invitado (lleva reservation_id desde el
// cambio B). Se correlaciona con guest_invitation_cancelled_by_owner por reservation_id.
const ORIGINAL_INVITATION_TEMPLATES = ['invited_by_player'];

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function ymd(ts) { return new Date(ts).toISOString().slice(0, 10); }
function pad2(n) { return String(n).padStart(2, '0'); }
function parseDate(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function mapRow(row) {
  const rendered = renderNotification(row);
  if (!rendered) return null;
  const d = new Date(row.created_at);
  return {
    id:          row.id,
    type:        rendered.imageType === 'venue_image' ? 'reservation' : 'app',
    title:       rendered.title,
    message:     rendered.body,
    gameDate:        row.games?.date_key    ?? null,
    gameTime:        row.games?.time        ?? null,
    gameDurationMin: row.games?.duration_min ?? null,
    time:        `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    dateKey:     ymd(d.getTime()),
    read:        row.read_at != null,
    createdAt:   d.getTime(),
    templateKey:    row.template_key ?? null,
    gameId:         row.game_id ?? null,
    reservationId:  row.reservation_id ?? null,
  };
}

function groupAndSort(list) {
  const map = {};
  for (const n of list) (map[n.dateKey] ??= []).push(n);
  for (const k of Object.keys(map)) map[k].sort((a, b) => b.createdAt - a.createdAt);
  return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
}

function groupLabel(dateKey) {
  const today    = ymd(Date.now());
  const tomorrow = ymd(Date.now() + 86400e3);
  const d = parseDate(dateKey);
  if (!d) return dateKey;
  const suffix = `${_DOW[d.getDay()]} ${pad2(d.getDate())} ${_MON[d.getMonth()]}`;
  if (dateKey === today)    return `Hoy, ${suffix}`;
  if (dateKey === tomorrow) return `Mañana ${suffix}`;
  return suffix;
}

// ── Reservation icon: foto de cancha con fecha encima
function ReservationIcon({ gameDate, read }) {
  const d   = parseDate(gameDate);
  const day = d ? pad2(d.getDate()) : '–';
  const mon = d ? _MON[d.getMonth()].toUpperCase() : '';

  return (
    <div style={{
      width: 44, height: 44, borderRadius: 11, flexShrink: 0, overflow: 'hidden',
      position: 'relative', opacity: read ? 0.5 : 1,
    }}>
      <img src={fieldImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.46)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: -0.5 }}>{day}</span>
        <span style={{ fontSize: 9,  fontWeight: 700, color: 'rgba(255,255,255,0.88)', letterSpacing: 0.6, marginTop: 1 }}>{mon}</span>
      </div>
    </div>
  );
}

// ── App icon: logo placeholder Algrass
function AppIcon({ read }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 11, background: '#fff', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: read ? 0.45 : 1, overflow: 'hidden',
    }}>
      <img src={algrassLogo} alt="Algrass" style={{ width: 58, height: 58, objectFit: 'contain', display: 'block' }} />
    </div>
  );
}

// ── Row — cada notificación en su propio card
function NotificationRow({ n, expanded, onPress, highlighted = false }) {
  const msgRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  const isExpanded = expanded && overflowing; // expandir solo si el texto excede 3 líneas
  const titleColor = TEXT;
  const msgColor   = '#3C3C44';

  // Medir el desborde real contra el clamp de 3 líneas (solo en estado colapsado,
  // para no entrar en bucle al expandir). título + hasta 3 filas → sin "Ver más".
  useEffect(() => {
    const el = msgRef.current;
    if (!el || isExpanded) return;
    setOverflowing(el.scrollHeight - el.clientHeight > 1);
  }, [n.message, isExpanded]);

  return (
    <button
      onClick={onPress}
      className={highlighted ? 'game-row-highlighted' : ''}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 0,
        padding: '9px 12px 9px 7px',
        background: n.read ? '#fff' : '#EDF5FF',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none',
        borderRadius: 13,
      }}>

      {n.type === 'reservation'
        ? <ReservationIcon gameDate={n.gameDate} read={n.read} />
        : <AppIcon read={n.read} />}

      {/* Separador vertical */}
      <div style={{ width: 1, background: n.read ? '#E8E8EE' : '#C6DEFF', marginLeft: 8, marginRight: 8, alignSelf: 'stretch' }} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 2 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: n.read ? 500 : 700, color: titleColor, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.title}
          </span>
          <span style={{ fontSize: 11, color: n.read ? '#C4C4CC' : SUB, flexShrink: 0 }}>{n.time}</span>
        </div>

        <div ref={msgRef} style={{
          fontSize: 12.5, color: msgColor, lineHeight: 1.42,
          display: isExpanded ? 'block' : '-webkit-box',
          WebkitLineClamp: isExpanded ? undefined : 3,
          WebkitBoxOrient: 'vertical',
          overflow: isExpanded ? 'visible' : 'hidden',
        }}>
          {n.message}
        </div>

        {overflowing && (
          <span style={{ fontSize: 11, color: BLUE, fontWeight: 600, marginTop: 3, display: 'block' }}>
            {isExpanded ? 'Ver menos' : 'Ver más'}
          </span>
        )}
      </div>

      {!n.read && (
        <div style={{ width: 8, height: 8, borderRadius: 4, background: BLUE, flexShrink: 0, marginLeft: 8 }} />
      )}
    </button>
  );
}

// ── Header
function Header({ hasUnread, onMarkAll }) {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', position: 'relative' }}>
        <div style={{ flex: 1, color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, textAlign: 'center' }}>
          Notificaciones
        </div>
        {hasUnread && (
          <button
            onClick={onMarkAll}
            style={{
              position: 'absolute', right: 0,
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
              color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500,
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
            Leído todo
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty state
function Empty() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 48 }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {I.bell(SUB)}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Sin notificaciones</div>
      <div style={{ fontSize: 13.5, color: SUB, textAlign: 'center', maxWidth: 220, lineHeight: 1.45 }}>
        Aquí aparecerán los avisos de tus reservas y partidos.
      </div>
    </div>
  );
}

// ── Staff invite row — shown at top of Notifications when invitation is pending
function StaffInviteRow({ invite, onOpen }) {
  const dateStr = invite.created_at
    ? new Date(invite.created_at).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })
    : null;
  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 0,
        padding: '9px 12px 9px 7px',
        background: '#EEF2FF',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none',
        borderRadius: 13,
      }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11, background: BLUE, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <circle cx="8" cy="7" r="3" stroke="#fff" strokeWidth="1.5"/>
          <path d="M2 18c0-3.3 2.7-6 6-6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="15" cy="12" r="3" stroke="#fff" strokeWidth="1.5"/>
          <path d="M9 21c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ width: 1, background: '#C6DEFF', marginLeft: 8, marginRight: 8, alignSelf: 'stretch' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 2 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TEXT, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {invite.venues?.name ?? 'Venue'}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: '#3C3C44', lineHeight: 1.42 }}>
          {dateStr ? `${dateStr} · ` : ''}
          Te invitó a formar parte del staff · <span style={{ color: BLUE, fontWeight: 600 }}>Ver</span>
        </div>
      </div>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: BLUE, flexShrink: 0, marginLeft: 8 }} />
    </button>
  );
}

// ── Screen
export default function Notifications() {
  const { user }   = useAuth();
  const staff      = useStaff();
  const navigate   = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [hasMore, setHasMore]             = useState(false);
  const [expandedIds, setExpandedIds]     = useState(() => new Set());
  const [unreadCount, setUnreadCount]     = useState(getNotifCount);
  const notifScrollRef         = useRef(null);
  const cursorRef              = useRef(null);
  const highlightedNotifRef    = useRef(null);
  const [highlightedNotifId, setHighlightedNotifId] = useState(null);

  useEffect(() => {
    function onTabScrollTop(e) {
      if (e.detail === 'notificaciones') notifScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('tab-scroll-top', onTabScrollTop);
    return () => window.removeEventListener('tab-scroll-top', onTabScrollTop);
  }, []);

  useEffect(() => {
    setUnreadCount(getNotifCount());
    function onBadge(e) { setUnreadCount(Math.max(0, e.detail || 0)); }
    window.addEventListener('notif-badge', onBadge);
    return () => window.removeEventListener('notif-badge', onBadge);
  }, []);

  const fgTick = useForegroundTick();
  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    supabase
      .from('notifications')
      .select(NOTIF_SELECT)
      .eq('recipient_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE + 1)
      .then(({ data }) => {
        const rows  = data ?? [];
        const more  = rows.length > PAGE_SIZE;
        const slice = more ? rows.slice(0, PAGE_SIZE) : rows;
        if (slice.length > 0) cursorRef.current = slice[slice.length - 1].created_at;
        setNotifications(slice.map(mapRow).filter(Boolean));
        setHasMore(more);
        setLoading(false);
      });
  }, [user?.id, fgTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!highlightedNotifId) return;
    const raf = requestAnimationFrame(() => {
      const el = highlightedNotifRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const visibleBottom = getVisibleBottom();
      const overBottom = rect.bottom - visibleBottom;
      const overTop    = 80 - rect.top;
      if (overBottom > 0 || overTop > 0) {
        const container = notifScrollRef.current;
        if (container) container.scrollBy({ top: overBottom > 0 ? overBottom + 12 : -(overTop + 12), behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightedNotifId]);

  useEffect(() => {
    if (!highlightedNotifId) return;
    const t = setTimeout(() => setHighlightedNotifId(null), 4500);
    return () => clearTimeout(t);
  }, [highlightedNotifId]);

  function loadMore() {
    if (!user?.id || loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    supabase
      .from('notifications')
      .select(NOTIF_SELECT)
      .eq('recipient_user_id', user.id)
      .lt('created_at', cursorRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE + 1)
      .then(({ data }) => {
        const rows  = data ?? [];
        const more  = rows.length > PAGE_SIZE;
        const slice = more ? rows.slice(0, PAGE_SIZE) : rows;
        if (slice.length > 0) cursorRef.current = slice[slice.length - 1].created_at;
        setNotifications(prev => [...prev, ...slice.map(mapRow).filter(Boolean)]);
        setHasMore(more);
        setLoadingMore(false);
      });
  }

  const groups    = useMemo(() => groupAndSort(notifications), [notifications]);
  const hasUnread = unreadCount > 0;

  async function handlePress(id) {
    const notif = notifications.find(n => n.id === id);
    const wasUnread = notif && !notif.read;
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    if (wasUnread) setNotifBadge(Math.max(0, getNotifCount() - 1));
    supabase.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .then(({ error, data, count, status, statusText }) => {
        if (error) console.error('[notif] handlePress update failed:', error, { status, statusText });
      });
    if (notif?.templateKey === 'waitlist_spot_available' && notif?.gameId) {
      navigate(`/game/${notif.gameId}`);
      return;
    }
    // Navegación parametrizable: mismo algoritmo para invitaciones y reservas propias;
    // solo cambia qué plantillas de cancelación pertenecen a cada tipo (CANCELLATION_TEMPLATES).
    const cancelTemplates = notif?.templateKey ? CANCELLATION_TEMPLATES[notif.templateKey] : null;
    // Reserva de cupos: navegar al partido si el usuario sigue confirmado (sin cancelación).
    const isSlotNav = notif?.templateKey === 'slots_reserved' || notif?.templateKey === 'slots_modified';
    if ((cancelTemplates || isSlotNav) && notif?.gameId) {
      // "Reserva viva" = existe ≥1 game_player CONFIRMADO que me pertenece
      // (titular O invitados: user_id | payer_id | invited_by_user_id = yo). Reutiliza
      // el mismo lookup, ampliando el filtro (para un invitado equivale a su propio slot).
      const findAlive = async () => {
        if (!supabase || !user?.id) return null;
        let q = supabase
          .from('game_players')
          .select('games:game_id(date_key, time, duration_min)')
          .eq('status', 'confirmed')
          .limit(1);
        // Nuevo modelo: identificar la reserva por reservation_id. Fallback (notifs
        // antiguas sin reservation_id): lógica previa por game_id + relación de usuario.
        q = notif.reservationId
          ? q.eq('reservation_id', notif.reservationId)
          : q.eq('game_id', notif.gameId).or(`user_id.eq.${user.id},payer_id.eq.${user.id},invited_by_user_id.eq.${user.id}`);
        const { data } = await q.maybeSingle();
        return data ?? null;
      };
      // Rental vivo: NO tiene game_players; se comprueba por el estado real del game
      // (type='rental' + status='reserved' + booked_by_user_id = usuario actual). Destino
      // propio de rental: /rental/:gameId (Perfil abre los rentals por esa misma ruta).
      const findAliveRental = async () => {
        if (!supabase || !user?.id || !notif.gameId) return false;
        const { data } = await supabase
          .from('games')
          .select('id')
          .eq('id', notif.gameId)
          .eq('type', 'rental')
          .eq('status', 'reserved')
          .eq('booked_by_user_id', user.id)
          .maybeSingle();
        return !!data;
      };
      // Cancelación relacionada más cercana (idéntico: filter + reduce). Correlación por
      // reservation_id; fallback por game_id si la notificación no lo tiene.
      const matchesReservation = notif.reservationId
        ? (n) => n.reservationId === notif.reservationId
        : (n) => n.gameId === notif.gameId;
      const findCancellation = () => notifications
        .filter(n => cancelTemplates.includes(n.templateKey) && matchesReservation(n) && n.createdAt > notif.createdAt)
        .reduce((closest, n) => !closest || n.createdAt < closest.createdAt ? n : closest, null);
      // Abrir el partido solo si NO ha terminado (gate isGamePast intacto → Caso D).
      const openGameIfLive = (row) => {
        if (row && !isGamePast(row.date_key, row.time, row.duration_min)) {
          navigate('/profile', { state: { highlightGame: notif.gameId } });
        }
      };

      if (isSlotNav) {
        // Reserva de cupos: si sigue confirmado en el partido (Próximos) → abrir, igual que
        // las reservas. Si no, no hacer nada (no existe pantalla de cancelación de cupos).
        openGameIfLive((await findAlive())?.games);
        return;
      }

      if (notif.templateKey === 'invited_by_player') {
        // Invitaciones: comportamiento ORIGINAL sin cambios (cancelación primero).
        const related = findCancellation();
        if (related) { setHighlightedNotifId(related.id); return; }
        openGameIfLive((await findAlive())?.games);
        return;
      }

      // Reservas propias (nueva regla): "reserva viva" tiene prioridad sobre la cancelación.
      const alive = await findAlive();          // Match vivo: titular o invitado confirmado
      if (alive) { openGameIfLive(alive.games); return; }
      if (await findAliveRental()) { navigate(`/rental/${notif.gameId}`); return; } // Rental vivo
      const related = findCancellation();       // nada vivo → cancelación del mismo ciclo (reservation_id)
      if (related) { setHighlightedNotifId(related.id); return; }
      return;
    }

    // ── NUEVO (aislado, reversible): navegación INVERSA desde una cancelación PROPIA.
    // Estos template_key NO son claves de CANCELLATION_TEMPLATES, así que la rama anterior no
    // los intercepta; aquí decidimos el destino según el estado ACTUAL. No modifica helpers ni
    // ramas existentes. Partido aún relevante → Perfil + highlight; si ya no queda nada suyo →
    // confirmación original del MISMO reservation_id (scroll/highlight in-screen); sin destino
    // fiable (p. ej. invitado sin reservation_id en su invitación) → comportamiento actual.
    if (OWN_CANCELLATION_TEMPLATES.includes(notif?.templateKey) && notif?.gameId) {
      // "Partido relevante" = MISMA semántica que el fallback de findAlive: existe ≥1 game_player
      // CONFIRMADO del usuario (plaza propia O invitados propios) en ese game. (Rental no tiene
      // game_players → false → va a la confirmación original.)
      const stillRelevant = await (async () => {
        if (!supabase || !user?.id) return false;
        const { data } = await supabase
          .from('game_players')
          .select('id')
          .eq('game_id', notif.gameId)
          .eq('status', 'confirmed')
          .or(`user_id.eq.${user.id},payer_id.eq.${user.id},invited_by_user_id.eq.${user.id}`)
          .limit(1)
          .maybeSingle();
        return !!data;
      })();
      if (stillRelevant) { navigate('/profile', { state: { highlightGame: notif.gameId } }); return; }
      if (notif.reservationId) {
        const original = notifications
          .filter(n => ORIGINAL_CONFIRMATION_TEMPLATES.includes(n.templateKey) && n.reservationId === notif.reservationId && n.createdAt < notif.createdAt)
          .reduce((latest, n) => !latest || n.createdAt > latest.createdAt ? n : latest, null);
        if (original) { setHighlightedNotifId(original.id); return; }
      }
      // Sin destino fiable → cae al comportamiento actual (expand/collapse) más abajo.
    }

    // ── NUEVO (aislado): cancelación de INVITADOS del titular → confirmación del MISMO lote.
    // Reutiliza EXACTAMENTE la misma correlación por reservation_id y el mismo highlight que la
    // rama de arriba. Solo reservation_cancelled_guests_credit; nunca Profile. Sin reservation_id
    // o sin confirmación cargada → comportamiento actual (expand). No usa game_id/nombres/texto.
    if (notif?.templateKey === 'reservation_cancelled_guests_credit' && notif.reservationId) {
      const original = notifications
        .filter(n => ORIGINAL_CONFIRMATION_TEMPLATES.includes(n.templateKey) && n.reservationId === notif.reservationId && n.createdAt < notif.createdAt)
        .reduce((latest, n) => !latest || n.createdAt > latest.createdAt ? n : latest, null);
      if (original) { setHighlightedNotifId(original.id); return; }
      // Sin confirmación → cae al comportamiento actual (expand) más abajo.
    }

    // ── NUEVO (aislado): invitado cancelado por el titular → invitación ORIGINAL del MISMO ciclo.
    // Misma correlación por reservation_id y mismo highlight. Solo guest_invitation_cancelled_by_owner
    // (NO guest_invitation_cancelled_credit, que es la del pagador). Sin reservation_id o sin la
    // invitación cargada (p. ej. invitaciones antiguas) → comportamiento actual (expand). Sin game_id.
    if (notif?.templateKey === 'guest_invitation_cancelled_by_owner' && notif.reservationId) {
      const original = notifications
        .filter(n => ORIGINAL_INVITATION_TEMPLATES.includes(n.templateKey) && n.reservationId === notif.reservationId && n.createdAt < notif.createdAt)
        .reduce((latest, n) => !latest || n.createdAt > latest.createdAt ? n : latest, null);
      if (original) { setHighlightedNotifId(original.id); return; }
      // Sin invitación original → cae al comportamiento actual (expand) más abajo.
    }
    setExpandedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function markAll() {
    if (!unreadCount) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setNotifBadge(0);
    supabase.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .then(({ error, count, status, statusText }) => {
        if (error) console.error('[notif] markAll update failed:', error, { status, statusText });
      });
  }

  if (!user) return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 32px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {I.bell(TEXT)}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: TEXT, lineHeight: 1.35, letterSpacing: -0.2, maxWidth: 280 }}>
          Debes tener una cuenta para ver tus notificaciones
        </div>
        <button onClick={() => navigate('/auth', { state: { backPath: '/notifications' } })} style={{
          padding: '4px 6px', marginTop: -4,
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 17, fontWeight: 700,
          color: ORANGE, letterSpacing: -0.1, lineHeight: 1.3,
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
          Suscríbete o ingresa a tu cuenta
        </button>
      </div>
      <TabBar />
    </div>
  );

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <Header hasUnread={hasUnread} onMarkAll={markAll} />

      <div ref={notifScrollRef} className="no-sb" style={{ flex: 1, overflowY: 'auto', background: SOFT, WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}>
        <div style={{ minHeight: 'calc(100% + 1px)', display: 'flex', flexDirection: 'column' }}>
          {/* Pending staff invitations — shown above regular notifications */}
          {(staff?.pendingInvites?.length > 0) && (
            <div>
              <div style={{ padding: '14px 16px 6px', fontSize: 11.5, fontWeight: 600, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                Invitaciones pendientes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, paddingRight: 12 }}>
                {staff.pendingInvites.map(inv => (
                  <StaffInviteRow
                    key={inv.id}
                    invite={inv}
                    onOpen={() => staff.setModalVisible(true)}
                  />
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
              <div style={{ color: SUB, fontSize: 14 }}>Cargando…</div>
            </div>
          ) : groups.length === 0 && !staff?.pendingInvites?.length ? (
            <Empty />
          ) : groups.length === 0 ? null : (
            groups.map(([dateKey, items]) => (
              <div key={dateKey}>
                <div style={{ padding: '14px 16px 6px', fontSize: 11.5, fontWeight: 600, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                  {groupLabel(dateKey)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, paddingRight: 12 }}>
                  {items.map(n => (
                    <div key={n.id} ref={n.id === highlightedNotifId ? highlightedNotifRef : null}>
                      <NotificationRow
                        n={n}
                        expanded={expandedIds.has(n.id)}
                        onPress={() => handlePress(n.id)}
                        highlighted={n.id === highlightedNotifId}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 8px' }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'transparent', border: 'none', cursor: loadingMore ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: loadingMore ? SUB : BLUE,
                  padding: '8px 16px', borderRadius: 10,
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                {loadingMore ? 'Cargando…' : 'Ver más'}
              </button>
            </div>
          )}
          <div style={{ height: 16 }} />
        </div>
      </div>

      <TabBar />
    </div>
  );
}
