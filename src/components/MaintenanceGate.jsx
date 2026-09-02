import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getMaintenanceStatus } from '../services/organizerContact';
import { fetchMyGlobalRoles } from '../services/userRolesService';
import { BLUE, GREEN } from '../constants';
import MaintenanceScreen from '../screens/MaintenanceScreen';
import MaintenanceAuthScreen from '../screens/MaintenanceAuthScreen';

// ── MaintenanceGate ─────────────────────────────────────────────────────────
// Nodo MÁS EXTERNO (main.jsx), envuelve a PrivateAccessGate. Vive fuera del router
// y de AuthProvider, así que resuelve sesión/roles por su cuenta (no usa contexto ni
// caché). Solo decide QUÉ renderizar; NUNCA navega/redirige.
//
// Rutas siempre públicas: pasan al instante sin consultar mantenimiento.
// Autoridad: get_maintenance_status() (mode) + auth.getSession() (sesión) +
// fetchMyGlobalRoles() (roles server-verified). Nunca se decide con localStorage.
// FAIL OPEN: cualquier fallo de lectura → children (un fallo de RPC no cierra la app).
//
// /maintenance/auth (solo si mode=ON y sin bypass) → login interno para personal
// autorizado. Conocer la URL NO es bypass: solo permite autenticarse; la autorización
// final sigue siendo sesión + user_roles del servidor.
const PUBLIC_PATHS = ['/privacy', '/terms', '/email-changed'];
const AUTH_PATH    = '/maintenance/auth';

function Splash() {
  // Neutro/full-screen. NO renderiza App por detrás. Evita flash de Intro/App/partidos.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100001, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1, opacity: 0.9 }}>
        <span style={{ color: BLUE }}>Al</span><span style={{ color: GREEN }}>Grass</span>
      </div>
    </div>
  );
}

export default function MaintenanceGate({ children }) {
  // Se lee una vez al montar (el gate vive fuera del router, igual que PrivateAccessGate).
  const path = (() => { try { return window.location.pathname; } catch { return ''; } })();
  const isPublic   = PUBLIC_PATHS.includes(path);
  const isAuthPath = path === AUTH_PATH;

  // 'loading' → splash; 'children' → app; 'maintenance' → pantalla; 'auth' → login interno.
  // Sin backend (supabase null) → FAIL OPEN directo desde el estado inicial (sin consultar).
  const [phase, setPhase] = useState(isPublic || !supabase ? 'children' : 'loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isPublic || !supabase) return;   // públicas o sin backend: no se consulta mantenimiento
    let alive = true;

    async function decide() {
      const status = await getMaintenanceStatus();
      if (!alive) return;
      // FAIL OPEN: error de lectura NO se interpreta como mantenimiento. mode=false → app.
      if (status.error || !status.mode) { setPhase('children'); return; }

      // mode = true → sesión AUTORITATIVA (no caché).
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const uid = data?.session?.user?.id ?? null;
      if (uid) {
        // Roles AUTORITATIVOS server-verified (user_roles vía RLS select-own). No caché.
        const roles = await fetchMyGlobalRoles(uid);
        if (!alive) return;
        if (roles.includes('algrass_admin') || roles.includes('algrass_staff')) { setPhase('children'); return; }
      }
      // Sin bypass: en /maintenance/auth mostrar login interno; en cualquier otra, mantenimiento.
      setMessage(status.message);
      setPhase(isAuthPath ? 'auth' : 'maintenance');
    }

    const fail = () => { if (alive) setPhase('children'); };   // cualquier throw → FAIL OPEN

    // onAuthStateChange dispara INITIAL_SESSION al suscribir (decisión inicial) y SIGNED_IN /
    // SIGNED_OUT tras login/logout (el login por correo NO recarga la página → re-evalúa aquí).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        decide().catch(fail);
      }
    });

    return () => { alive = false; subscription?.unsubscribe(); };
  }, [isPublic, isAuthPath]);

  if (phase === 'maintenance') return <MaintenanceScreen message={message} />;
  if (phase === 'auth')        return <MaintenanceAuthScreen />;
  if (phase === 'loading')     return <Splash />;
  return children;
}
