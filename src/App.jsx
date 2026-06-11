import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StaffProvider, useStaff } from './context/StaffContext';
import StaffInviteModal from './components/StaffInviteModal';
import Sidebar from './components/Sidebar';
import IntroScreen from './screens/IntroScreen';
import { supabase } from './lib/supabase';
import { setNotifBadge } from './utils/notifBadge';

const INTRO_KEY = 'algrass_intro_seen';


function NotifBadgeSync() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!user?.id) { setNotifBadge(0); return; }
    if (pathname === '/notifications') return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .then(({ count }) => setNotifBadge(count ?? 0));
  }, [user?.id, pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function StaffModalBridge() {
  const staff = useStaff();
  if (!staff?.modalVisible) return null;
  return <StaffInviteModal />;
}

const Welcome      = lazy(() => import('./screens/Welcome'));
const PickupGames  = lazy(() => import('./screens/PickupGames'));
const GameDetail   = lazy(() => import('./screens/GameDetail'));
const AuthScreen   = lazy(() => import('./screens/Auth'));
const AuthGate     = lazy(() => import('./screens/Auth').then(m => ({ default: m.AuthGate })));
const Profile      = lazy(() => import('./screens/Profile'));
const Settings     = lazy(() => import('./screens/Settings'));
const Fields        = lazy(() => import('./screens/Fields'));
const FieldDetail   = lazy(() => import('./screens/FieldDetail'));
const RentalDetail  = lazy(() => import('./screens/RentalDetail'));
const Notifications = lazy(() => import('./screens/Notifications'));

const WELCOME_KEY = 'pichanga_welcome_seen';

function RootRedirect() {
  return <Navigate to={localStorage.getItem(WELCOME_KEY) ? '/games' : '/welcome'} replace />;
}

function Placeholder({ title }) {
  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F2F2F4', color: '#6B6B70', fontSize: 16, fontWeight: 600 }}>
      {title}
    </div>
  );
}

function RouteShell() {
  let seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch {}
  return (
    <div
      className="screen-shell"
      style={{ background: seen ? '#fff' : '#000' }}
    />
  );
}

// IntroGate lives inside BrowserRouter so it can navigate directly.
// onStart fires at button-click → navigate + Games starts loading during the fade.
// onDone fires 480ms later → removes IntroScreen after fade completes.
function IntroGate() {
  const navigate = useNavigate();
  const [introDone, setIntroDone] = useState(() => {
    try {
      const done = !!localStorage.getItem(INTRO_KEY);
      if (done) {
        const m = document.querySelector('meta[name="theme-color"]');
        if (m) m.content = '#3F5FE0';
        document.documentElement.classList.add('app-ready');
      }
      return done;
    } catch { return true; }
  });

  if (introDone) return null;
  return (
    <IntroScreen
      onStart={() => {
        try { localStorage.setItem(WELCOME_KEY, '1'); } catch {}
      }}
      onDone={() => {
        setIntroDone(true);
        setTimeout(() => navigate('/games', { state: { showCitySheet: true } }), 0);
      }}
    />
  );
}

// TEMP test de safe-area — pantalla verde previa al Intro, overlay fixed inset:0
// sin usar ningún layout de la app. Reversible: borrar este componente, su estado
// y su render.
function SafeAreaTest({ onContinue }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#00ff00', zIndex: 2147483647,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24,
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#000', letterSpacing: -0.5 }}>SAFE AREA TEST</div>
      <button onClick={onContinue} style={{
        padding: '14px 28px', borderRadius: 999, border: 'none',
        background: '#000', color: '#fff', fontSize: 16, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
      }}>Continuar</button>
    </div>
  );
}

// TEMP diagnóstico de modo de ejecución PWA. Reversible: borrar componente + render.
function ModeDiag() {
  const probeRef = useRef(null);
  const [m, setM] = useState(null);
  useEffect(() => {
    const read = () => {
      const sab = probeRef.current ? Math.round(probeRef.current.getBoundingClientRect().height) : null;
      const data = {
        navStandalone: window.navigator.standalone,
        mqStandalone:  window.matchMedia('(display-mode: standalone)').matches,
        referrer:      document.referrer || '(vacío)',
        href:          window.location.href,
        visualVH:      window.visualViewport ? Math.round(window.visualViewport.height) : null,
        innerHeight:   window.innerHeight,
        safeBottom:    sab,
      };
      setM(data);
      console.log('[MODE-DIAG]', data);
    };
    read();
    const id = setInterval(read, 1000);
    window.addEventListener('resize', read);
    return () => { clearInterval(id); window.removeEventListener('resize', read); };
  }, []);
  const isStandalone = m && (m.navStandalone === true || m.mqStandalone === true);
  return (
    <>
      <div ref={probeRef} style={{ position: 'fixed', bottom: 0, left: 0, width: 1, height: 'env(safe-area-inset-bottom)', opacity: 0, pointerEvents: 'none' }} />
      {m && (
        <div style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top) + 8px)', left: 8, right: 8,
          zIndex: 2147483647, background: 'rgba(0,0,0,0.9)', color: '#0f0',
          font: '11px/1.5 monospace', padding: '10px 12px', borderRadius: 8,
          whiteSpace: 'pre-wrap', pointerEvents: 'none',
        }}>
{`MODE-DIAG
navigator.standalone        = ${m.navStandalone}
matchMedia standalone       = ${m.mqStandalone}
document.referrer           = ${m.referrer}
location.href               = ${m.href}
visualViewport.height       = ${m.visualVH}
window.innerHeight          = ${m.innerHeight}
env(safe-area-inset-bottom) = ${m.safeBottom}px
→ ¿standalone real?         = ${isStandalone ? 'SÍ' : 'NO (Safari/embebido)'}`}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [safeTestDone, setSafeTestDone] = useState(false);
  return (
    <AuthProvider>
    <StaffProvider>
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="app-main">
          <Suspense fallback={<RouteShell />}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/games" element={<PickupGames />} />
              <Route path="/game/:id" element={<GameDetail />} />
              <Route path="/auth" element={<AuthScreen />} />
              <Route path="/checkout" element={<AuthGate />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/fields" element={<Fields />} />
              <Route path="/field/:id" element={<FieldDetail />} />
              <Route path="/rental/:id" element={<RentalDetail />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/organizer" element={<Placeholder title="Organizador" />} />
              <Route path="/admin" element={<Placeholder title="Admin" />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <NotifBadgeSync />
      <StaffModalBridge />
      <IntroGate />
      {!safeTestDone && <SafeAreaTest onContinue={() => setSafeTestDone(true)} />}
      <ModeDiag />
    </BrowserRouter>
    </StaffProvider>
    </AuthProvider>
  );
}
