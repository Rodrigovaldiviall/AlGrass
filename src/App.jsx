import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StaffProvider, useStaff } from './context/StaffContext';
import StaffInviteModal from './components/StaffInviteModal';
import Sidebar from './components/Sidebar';
import IntroScreen from './screens/IntroScreen';
import { supabase } from './lib/supabase';
import { setNotifBadge } from './utils/notifBadge';
import { setWaitlistBadge } from './utils/waitlistBadge';
import { hasAvailableWaitlistSpot } from './services/waitlistService';
import { useForegroundTick } from './hooks/useForegroundTick';

const INTRO_KEY = 'algrass_intro_seen';


// Al volver a primer plano: (A) emite 'app-foreground' SIEMPRE para que las
// pantallas re-fetcheen en sitio; (B) comprueba versión nueva del SW solo si
// pasaron >4h (deja el SW nuevo en 'waiting', sin recargar ni activar en sesión).
function AppLifecycle() {
  useEffect(() => {
    let lastSWCheck = 0;
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.dispatchEvent(new CustomEvent('app-foreground'));
      const now = Date.now();
      if (now - lastSWCheck > FOUR_HOURS && 'serviceWorker' in navigator) {
        lastSWCheck = now;
        navigator.serviceWorker.getRegistration().then((r) => r && r.update());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return null;
}

function NotifBadgeSync() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const fgTick = useForegroundTick();
  useEffect(() => {
    if (!user?.id) { setNotifBadge(0); return; }
    if (pathname === '/notifications') return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .then(({ count }) => setNotifBadge(count ?? 0));
  }, [user?.id, pathname, fgTick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Publica el booleano de "oportunidad activa de waitlist" para TabBar/Sidebar.
// Recalcula al cambiar de usuario, de ruta o al volver a primer plano.
function WaitlistBadgeSync() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const fgTick = useForegroundTick();
  useEffect(() => {
    if (!user?.id) { setWaitlistBadge(false); return; }
    hasAvailableWaitlistSpot(user.id).then(setWaitlistBadge);
  }, [user?.id, pathname, fgTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Expiración real de waitlist (persistencia/analítica): se dispara SOLO cuando la sesión Supabase
  // (JWT) ya está cargada — no cuando user?.id se hidrata síncrono desde localStorage. 1× por sesión,
  // idempotente, sin polling. Captura el error para no ocultar fallos.
  useEffect(() => {
    if (!supabase) return;
    let fired = false;
    const run = (session) => {
      if (fired || !session) return;
      fired = true;
      supabase.rpc('expire_waitlists').then(({ error }) => {
        if (error) console.warn('[waitlist] expire_waitlists failed:', error);
      });
    };
    supabase.auth.getSession().then(({ data }) => run(data?.session));                          // sesión ya presente al montar
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => run(session)); // o cuando llega
    return () => subscription?.unsubscribe();
  }, []);
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
const VenueDetail   = lazy(() => import('./screens/VenueDetail'));
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

export default function App() {
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
              <Route path="/venue" element={<VenueDetail />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/organizer" element={<Placeholder title="Organizador" />} />
              <Route path="/admin" element={<Placeholder title="Admin" />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <NotifBadgeSync />
      <WaitlistBadgeSync />
      <StaffModalBridge />
      <AppLifecycle />
      <IntroGate />
    </BrowserRouter>
    </StaffProvider>
    </AuthProvider>
  );
}
