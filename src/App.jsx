import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { StaffProvider, useStaff } from './context/StaffContext';
import StaffInviteModal from './components/StaffInviteModal';
import Sidebar from './components/Sidebar';

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
  return <div className="screen-shell" style={{ background: '#F2F2F4' }} />;
}

export default function App() {
  return (
    <AuthProvider>
    <StaffProvider>
    <BrowserRouter>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 'env(safe-area-inset-top)',
        background: '#3F5FE0',
        zIndex: 99999,
        pointerEvents: 'none',
      }} />
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
      <StaffModalBridge />
    </BrowserRouter>
    </StaffProvider>
    </AuthProvider>
  );
}
