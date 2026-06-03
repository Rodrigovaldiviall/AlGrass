import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, TAB_INACTIVE, RED } from '../constants';
import I from '../icons';
import { haptic } from '../utils/haptic';
import { readNotifBadgeLabel, badgeLabel } from '../utils/notifBadge';

const TABS = [
  { id: 'partidos',       icon: I.search,  label: 'Partidos',       route: '/games' },
  { id: 'campos',         icon: I.fields,  label: 'Canchas',         route: '/fields' },
  { id: 'notificaciones', icon: I.bell,    label: 'Notificaciones', route: '/notifications' },
  { id: 'perfil',         icon: I.profile, label: 'Perfil',         route: '/profile' },
];

// Routes whose pathname exactly equals the key are "root" screens for that tab.
const ROOT_ROUTES = {
  '/games':         'partidos',
  '/fields':        'campos',
  '/notifications': 'notificaciones',
  '/profile':       'perfil',
};

const SESSION_KEY = 'algr_sidebar_ctx';

function tabFromPath(pathname) {
  // Exact root match
  if (ROOT_ROUTES[pathname]) return ROOT_ROUTES[pathname];
  // Prefix-rooted sub-paths (e.g. /profile/x, /fields/x)
  if (pathname.startsWith('/profile'))       return 'perfil';
  if (pathname.startsWith('/notifications')) return 'notificaciones';
  if (pathname.startsWith('/fields'))        return 'campos';
  if (pathname.startsWith('/games'))         return 'partidos';
  // All other sub-screens (/settings, /game/:id, /checkout, …): preserve last root context
  return sessionStorage.getItem(SESSION_KEY) || 'partidos';
}


function getUpcomingBadge() {
  try {
    const list = JSON.parse(sessionStorage.getItem('pichanga_reservations'));
    if (!Array.isArray(list)) return undefined;
    const n = list.length;
    return n === 0 ? undefined : n;
  } catch { return undefined; }
}

export default function Sidebar() {
  const navigate     = useNavigate();
  const { pathname } = useLocation();

  const isRootScreen = Boolean(ROOT_ROUTES[pathname]);
  const activeTab    = tabFromPath(pathname);

  const [notifBadge, setNotifBadgeState] = useState(readNotifBadgeLabel);

  useEffect(() => {
    if (isRootScreen) sessionStorage.setItem(SESSION_KEY, ROOT_ROUTES[pathname]);
  }, [pathname, isRootScreen]);

  useEffect(() => {
    setNotifBadgeState(readNotifBadgeLabel());
    function onBadge(e) { setNotifBadgeState(badgeLabel(e.detail)); }
    window.addEventListener('notif-badge', onBadge);
    return () => window.removeEventListener('notif-badge', onBadge);
  }, []);

  const badges = { notificaciones: notifBadge, perfil: getUpcomingBadge() };

  return (
    <nav className="sidebar">
      {/* Brand */}
      <div style={{ padding: '48px 30px 27px', borderBottom: `1px solid ${HAIR}` }}>
        <div style={{ fontSize: 33, fontWeight: 800, color: BLUE, letterSpacing: -1.2, lineHeight: 1 }}>
          Algrass
        </div>
        <div style={{ fontSize: 18, color: SUB, marginTop: 8, letterSpacing: -0.1 }}>
          Encuentra tu partido
        </div>
      </div>

      {/* Nav items */}
      <div style={{ padding: '15px 12px', flex: 1 }}>
        {TABS.map(t => {
          const isActive = activeTab === t.id;
          const badge    = badges[t.id];
          return (
            <button
              key={t.id}
              onClick={() => {
                haptic();
                if (isActive) {
                  if (isRootScreen) {
                    // Already on the root screen of this tab → scroll to top
                    window.dispatchEvent(new CustomEvent('tab-scroll-top', { detail: t.id }));
                  } else {
                    // On a sub-screen of this tab → return to its root
                    navigate(t.route);
                  }
                } else {
                  navigate(t.route);
                }
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 18,
                padding: '17px 21px', borderRadius: 18, border: 'none',
                background: isActive ? `${BLUE}15` : 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent', outline: 'none',
                marginBottom: 3, transition: 'background .15s ease',
              }}
            >
              <div style={{
                position: 'relative', flexShrink: 0,
                width: 36, height: 36,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {t.icon(isActive ? BLUE : TAB_INACTIVE)}
                {badge !== undefined && (
                  <div style={{
                    position: 'absolute', top: -6, right: -12,
                    minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999,
                    background: RED, color: '#fff', fontSize: 14, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxSizing: 'border-box',
                  }}>{badge}</div>
                )}
              </div>
              <span style={{
                fontSize: 22, fontWeight: isActive ? 600 : 500,
                color: isActive ? BLUE : TEXT, letterSpacing: -0.2,
              }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
