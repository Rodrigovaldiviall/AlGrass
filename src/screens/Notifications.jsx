import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, SOFT, ORANGE } from '../constants';
import TabBar from '../components/TabBar';
import I from '../icons';
import fieldImg from '../assets/cancha.jpg';
import { useAuth } from '../context/AuthContext';
import { useStaff } from '../context/StaffContext';

const STORAGE_KEY = 'pichanga_notifications_v2';
const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;
const LONG_MSG    = 100;

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function ymd(ts) { return new Date(ts).toISOString().slice(0, 10); }
function pad2(n) { return String(n).padStart(2, '0'); }
function parseDate(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

const _T = Date.now();
const SEED = [
  { id: 'n1', type: 'reservation', title: 'La Satalia',        gameDate: ymd(_T + 86400e3),      message: 'Tu reserva está confirmada para mañana a las 7:00 PM. Recuerda llegar 10 minutos antes con tus taloneras y ropa deportiva.',         time: '15:22', dateKey: ymd(_T),               read: false, createdAt: _T - 1800e3      },
  { id: 'n2', type: 'app',         title: 'Algrass',        gameDate: null,                   message: 'Nuevos campos disponibles en tu zona. Reserva antes de que se agoten los cupos del fin de semana.',                                   time: '11:00', dateKey: ymd(_T),               read: false, createdAt: _T - 4 * 3600e3  },
  { id: 'n3', type: 'reservation', title: 'Xaloc',             gameDate: ymd(_T + 2 * 86400e3),  message: 'Recordatorio: tienes un partido el sábado a las 6:30 PM en Av. Primavera 314. El pago mínimo es S/.45 por jugador. ¡Te esperamos!',  time: '08:00', dateKey: ymd(_T + 86400e3),     read: false, createdAt: _T + 86400e3     },
  { id: 'n4', type: 'reservation', title: 'Agapito Fernández', gameDate: ymd(_T),                message: '¡Tu partido de hoy está casi lleno! Solo quedan 2 cupos. El organizador estará en la cancha a las 6:45 PM.',                          time: '09:30', dateKey: ymd(_T - 2 * 86400e3), read: true,  createdAt: _T - 2 * 86400e3 },
];

function loadNotifications() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(s) && s.length) return s;
  } catch {}
  return SEED;
}

function purgeExpired(list) {
  const cutoff = Date.now() - SEVEN_DAYS;
  return list.filter(n => n.type === 'app' || n.createdAt >= cutoff);
}

function persist(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function groupAndSort(list) {
  const map = {};
  for (const n of list) (map[n.dateKey] ??= []).push(n);
  for (const k of Object.keys(map)) map[k].sort((a, b) => b.time.localeCompare(a.time));
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
      width: 44, height: 44, borderRadius: 11, background: BLUE, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: read ? 0.45 : 1,
    }}>
      {/* Algrass logo placeholder — reemplazar con logo real cuando esté disponible */}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.6"/>
        <path d="M12 7l2.8 2v3.2L12 14.2l-2.8-2.2V9L12 7z" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round"/>
        <path d="M9.2 9L6.5 10.5M14.8 9L17.5 10.5M12 14.2V17M9.2 12.2L7.5 15M14.8 12.2L16.5 15" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// ── Row — cada notificación en su propio card
function NotificationRow({ n, expanded, onPress }) {
  const isLong     = n.message.length > LONG_MSG;
  const isExpanded = expanded || !isLong;
  const titleColor = TEXT;
  const msgColor   = '#3C3C44';

  return (
    <button
      onClick={onPress}
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

        <div style={{
          fontSize: 12.5, color: msgColor, lineHeight: 1.42,
          display: isExpanded ? 'block' : '-webkit-box',
          WebkitLineClamp: isExpanded ? undefined : 2,
          WebkitBoxOrient: isExpanded ? undefined : 'vertical',
          overflow: isExpanded ? 'visible' : 'hidden',
        }}>
          {n.message}
        </div>

        {isLong && (
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
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
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
  const [notifications, setNotifications] = useState(() => purgeExpired(loadNotifications()));
  const [expandedIds, setExpandedIds]     = useState(() => new Set());
  const notifScrollRef = useRef(null);

  useEffect(() => {
    function onTabScrollTop(e) {
      if (e.detail === 'notificaciones') notifScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('tab-scroll-top', onTabScrollTop);
    return () => window.removeEventListener('tab-scroll-top', onTabScrollTop);
  }, []);

  const groups    = useMemo(() => groupAndSort(notifications), [notifications]);
  const hasUnread = useMemo(() => notifications.some(n => !n.read), [notifications]);

  function handlePress(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setNotifications(prev => {
      const next = prev.map(n => n.id === id ? { ...n, read: true } : n);
      persist(next);
      return next;
    });
  }

  function markAll() {
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      persist(next);
      return next;
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

          {groups.length === 0 && !staff?.pendingInvites?.length ? (
            <Empty />
          ) : groups.length === 0 ? null : (
            groups.map(([dateKey, items]) => (
              <div key={dateKey}>
                <div style={{ padding: '14px 16px 6px', fontSize: 11.5, fontWeight: 600, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                  {groupLabel(dateKey)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, paddingRight: 12 }}>
                  {items.map(n => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      expanded={expandedIds.has(n.id)}
                      onPress={() => handlePress(n.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          <div style={{ height: 16 }} />
        </div>
      </div>

      <TabBar />
    </div>
  );
}
