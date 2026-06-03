import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StaffProvider, useStaff } from './context/StaffContext';
import StaffInviteModal from './components/StaffInviteModal';
import Sidebar from './components/Sidebar';
import logo from './assets/logo.webp';
import IntroScreen from './screens/IntroScreen';
import { supabase } from './lib/supabase';
import { setNotifBadge } from './utils/notifBadge';

const INTRO_KEY = 'algrass_intro_seen';


function NotifBadgeSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) { setNotifBadge(0); return; }
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .then(({ count }) => setNotifBadge(count ?? 0));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  return (
    <div className="screen-shell" style={{ background: '#3F5FE0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={logo} alt="Algrass" style={{ width: 130, height: 'auto', objectFit: 'contain', animation: 'logo-spin 1.6s ease-in-out forwards' }} />
    </div>
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
    </BrowserRouter>
    </StaffProvider>
    </AuthProvider>
  );
}
