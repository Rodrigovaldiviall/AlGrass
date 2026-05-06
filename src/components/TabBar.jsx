import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TAB_INACTIVE, ORANGE } from '../constants';
import I from '../icons';
import { haptic } from '../utils/haptic';

const TABS = [
  { id: 'partidos',       icon: I.search,  label: 'Partidos',       route: '/games' },
  { id: 'campos',         icon: I.fields,  label: 'Canchas',         route: '/fields' },
  { id: 'notificaciones', icon: I.bell,    label: 'Notificaciones', route: '/notifications' },
  { id: 'perfil',         icon: I.profile, label: 'Perfil',         route: '/profile' },
];

const MON_TB = { 'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Ago': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11 };
function _parseDT(g) {
  if (!g) return null;
  const p = (g.date || '').split(' ');
  if (p.length < 4) return null;
  const day = parseInt(p[1]), mon = MON_TB[p[2]], yr = parseInt(p[3]);
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const [hS = '0', mS = '0'] = (g.time || '0:00').split(':');
  let h = parseInt(hS) || 0;
  const m = parseInt(mS) || 0;
  if ((g.ampm || '').toUpperCase() === 'PM' && h !== 12) h += 12;
  if ((g.ampm || '').toUpperCase() === 'AM' && h === 12) h = 0;
  return new Date(yr, mon, day, h, m);
}
function _isGamePast(g) { const dt = _parseDT(g); return dt ? new Date(dt.getTime() + 90 * 60 * 1000) < new Date() : false; }

function getNotifBadge() {
  try {
    const list = JSON.parse(localStorage.getItem('pichanga_notifications_v2'));
    if (!Array.isArray(list)) return undefined;
    const n = list.filter(x => !x.read).length;
    return n === 0 ? undefined : n > 5 ? '5+' : n;
  } catch { return undefined; }
}

function getUpcomingBadge() {
  try {
    const list = JSON.parse(sessionStorage.getItem('pichanga_reservations'));
    if (!Array.isArray(list)) return undefined;
    const n = list.filter(g => !_isGamePast(g)).length;
    return n === 0 ? undefined : n;
  } catch { return undefined; }
}

function tabFromPath(pathname, backPath) {
  if (pathname.startsWith('/profile')) return 'perfil';
  if (pathname.startsWith('/notifications')) return 'notificaciones';
  if ((pathname.startsWith('/game/') || pathname.startsWith('/field/')) && backPath === '/profile') return 'perfil';
  if (pathname.startsWith('/fields') || pathname.startsWith('/field/')) return 'campos';
  return 'partidos';
}

function TabItem({ icon, label, active, badge, onClick }) {
  const color = active ? BLUE : TAB_INACTIVE;
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 4, position: 'relative',
        paddingTop: 8, paddingBottom: 4,
        background: 'transparent', border: 'none', cursor: 'pointer',
        outline: 'none', WebkitTapHighlightColor: 'transparent',
        fontFamily: 'inherit',
        transform: pressed ? 'scale(0.92)' : 'scale(1)',
        opacity: pressed ? 0.75 : 1,
        transition: 'transform .12s ease, opacity .12s ease',
      }}>
      <div style={{ position: 'relative' }}>
        {icon(color, active)}
        {badge !== undefined && (
          <div style={{
            position: 'absolute', top: -4, right: -10,
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
            background: ORANGE, color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxSizing: 'border-box',
          }}>{badge}</div>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: active ? 600 : 500, color, letterSpacing: -0.1 }}>{label}</div>
    </button>
  );
}

export default function TabBar({ activeTab: activeProp }) {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const activeTab = activeProp ?? tabFromPath(pathname, state?.backPath);
  const isDetailScreen = pathname.startsWith('/game/') || pathname.startsWith('/field/');

  const badges = { notificaciones: getNotifBadge(), perfil: getUpcomingBadge() };

  return (
    <div className="tab-bar" style={{
      borderTop: '1px solid #E5E5EA', background: '#fff',
      display: 'flex', paddingBottom: 'calc(env(safe-area-inset-bottom) + 4px)', paddingTop: 4,
    }}>
      {TABS.map(t => (
        <TabItem
          key={t.id}
          icon={t.icon}
          label={t.label}
          badge={badges[t.id]}
          active={activeTab === t.id}
          onClick={() => {
            haptic();
            if (activeTab === t.id) {
              if (isDetailScreen) {
                navigate(t.route);
              } else {
                window.dispatchEvent(new CustomEvent('tab-scroll-top', { detail: t.id }));
              }
            } else {
              navigate(t.route);
            }
          }}
        />
      ))}
    </div>
  );
}
