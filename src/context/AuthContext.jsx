import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getUser, setUser, removeUser } from '../services/userService';
import { ensureUserCode } from '../utils/format';

const AuthContext = createContext(null);

// Keys that belong to the device, not the user — preserved across logout.
const _DEVICE_KEYS = new Set(['algrass_intro_seen', 'pichanga_welcome_seen', 'pichanga_coach_seen']);
// Dynamic key prefixes (uid / gameId suffixes) scrubbed by scan.
const _USER_PREFIXES = ['pf_player_rows_', 'pg_player_rows_', 'pg_waitlist_', 'gd_roster_', 'pichanga_global_roles_'];
// Static user-scoped localStorage keys.
const _USER_STATIC = [
  'pichanga_user', 'pichanga_profile', 'pichanga_reservations', 'pichanga_rental_games',
  'pichanga_hosted_games', 'pichanga_waitlist', 'pichanga_credit', 'pichanga_ratings',
  'pichanga_skipped_ratings', 'pichanga_shown_confirmations', 'pichanga_played_games',
  'pichanga_game_rosters', 'pichanga_self_cancelled_guests', 'pichanga_usercodes',
  'pichanga_users', 'pichanga_role', 'pichanga_privacy', 'pichanga_notif',
  'pichanga_notif_unread', 'staff_invites_last_dismissed_at',
];
// Static user-scoped sessionStorage keys.
const _SESSION_STATIC = ['pg_confirmed_counts', 'profile_dirty', 'pf_scroll', 'pf_back', 'algr_sidebar_ctx'];

// Remove every user-scoped cache (static + dynamic-prefix) from both storages,
// preserving only device-level onboarding flags. Prevents user B from seeing user A's data.
function clearUserScopedCache() {
  try {
    _USER_STATIC.forEach(k => localStorage.removeItem(k));
    for (const k of Object.keys(localStorage)) {
      if (_DEVICE_KEYS.has(k)) continue;
      if (_USER_PREFIXES.some(p => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch {}
  try {
    _SESSION_STATIC.forEach(k => sessionStorage.removeItem(k));
    for (const k of Object.keys(sessionStorage)) {
      if (_USER_PREFIXES.some(p => k.startsWith(p))) sessionStorage.removeItem(k);
    }
  } catch {}
}

// ── Reconciliación determinista de correo (Auth → public.users) ──────────────
// Fuente AUTORITATIVA: supabase.auth.getUser() consulta al SERVIDOR de Auth y
// devuelve el email VIGENTE ya confirmado (auth.users.email). A diferencia de
// getSession()/session.user.email —que provienen del JWT persistido y pueden
// quedar ANTIGUOS tras un cambio confirmado en otro dispositivo hasta que el
// token se refresque (TOKEN_REFRESHED no es determinista por apertura)—, getUser
// no depende de que llegue ningún evento en tiempo real. Idempotente y
// autolimitada: solo escribe si public.users difiere. confirmed_email = ese email
// porque, al ser auth.users.email vigente, Supabase YA lo confirmó (un cambio de
// correo pendiente NO altera auth.users.email; solo lo hace al confirmarse).
// DEVUELVE el email autoritativo (o null si getUser falla) para que el caller deje
// también el user React + cache (pichanga_user) canónicos, sin otra llamada getUser.
async function reconcileEmailFromAuth() {
  const { data, error } = await supabase.auth.getUser();
  const authUser = data?.user;
  if (error || !authUser?.id || !authUser.email) return null; // fallo transitorio → no tocar nada
  // Reconcilia public.users SOLO si difiere (idempotente; una escritura como mucho).
  const { data: row } = await supabase
    .from('users').select('email').eq('id', authUser.id).maybeSingle();
  if (row?.email && row.email !== authUser.email) {
    const { error: upErr } = await supabase
      .from('users')
      .update({ email: authUser.email, confirmed_email: authUser.email })
      .eq('id', authUser.id);
    if (upErr) console.warn('[auth] email reconcile:', upErr.message);
  }
  return authUser.email;
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => getUser());

  function login(userData) {
    setUserState(userData);
    setUser(userData);
  }

  // Aplica el email AUTORITATIVO (de reconcileEmailFromAuth) al user React + cache
  // pichanga_user, sin reconstruir el resto del usuario. No-op si el email no cambió
  // (evita re-render/escritura innecesarios, CASO 4) o si es null (getUser falló →
  // no tocar sesión ni cache). Nunca crea un user desde null (no rompe logout).
  function applyAuthoritativeEmail(email) {
    if (!email) return;
    setUserState(prev => (prev && prev.email !== email) ? { ...prev, email } : prev);
    const cur = getUser();
    if (cur && cur.email !== email) setUser({ ...cur, email });
  }

  function logout() {
    setUserState(null);
    removeUser();
    clearUserScopedCache();
    try { sessionStorage.setItem('auth_prefer_login', '1'); } catch {}
    supabase?.auth.signOut();
  }

  // ── Account linking ────────────────────────────────────────────────────
  // Vincula un proveedor OAuth adicional a la sesión activa del usuario.
  // Requiere "Allow linking of identities" habilitado en el Dashboard.
  // Uso: const { error } = await linkProvider('google')
  async function linkProvider(provider) {
    if (!supabase) return { error: new Error('Supabase no configurado') };
    // linkIdentity redirige al flujo OAuth del proveedor. Al volver,
    // onAuthStateChange recibirá SIGNED_IN con la sesión actualizada
    // que ya incluye la nueva identidad en session.user.identities.
    return supabase.auth.linkIdentity({ provider });
  }

  // Desvincula una identidad por su ID (identity.id de user.identities[n]).
  // El usuario debe tener al menos otra identidad o contraseña activa.
  // Uso: const { error } = await unlinkProvider(identityId)
  async function unlinkProvider(identityId) {
    if (!supabase) return { error: new Error('Supabase no configurado') };
    return supabase.auth.unlinkIdentity({ identityId });
  }
  // ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Insert welcome notification on first registration (not on subsequent logins).
      // Guard: created_at within 120 s of now → brand-new account.
      if (event === 'SIGNED_IN' && session) {
        const ageMs = Date.now() - new Date(session.user.created_at).getTime();
        if (ageMs < 120_000) {
          supabase.from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_user_id', session.user.id)
            .eq('template_key', 'welcome_message')
            .then(({ count, error: checkErr }) => {
              if (checkErr) { console.error('[notif] welcome_message dedup check failed:', checkErr); return; }
              if ((count ?? 0) > 0) { return; }
              supabase.from('notifications').insert({
                recipient_user_id: session.user.id,
                source_type:       'algrass',
                delivery_type:     'automatic',
                category:          'onboarding',
                template_key:      'welcome_message',
                sent_at:           new Date().toISOString(),
              }).then(({ error }) => {
                if (error) console.error('[notif] welcome_message failed:', error);
              });
            });
        }
      }

      // INITIAL_SESSION fires on every page load with the persisted Supabase session —
      // handling it here ensures the React user state is always derived from the live
      // Supabase session, not from a potentially stale pichanga_user localStorage entry.
      // PASSWORD_RECOVERY: verifyOtp({type:'recovery'}) crea una sesión válida. Lo tratamos
      // como SIGNED_IN para que, tras cambiar la contraseña, el usuario quede autenticado en
      // la app sin volver al login (red de seguridad por si el SDK no emite SIGNED_IN aquí).
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY') && session) {
        const su = session.user;
        const metaName = su.user_metadata?.full_name || su.user_metadata?.name || null;
        const name = metaName || 'Usuario';
        const email = su.email || '';
        const provider = su.app_metadata?.provider || 'email';
        const providers = (su.identities ?? []).map(i => i.provider);
        const identities = (su.identities ?? []).map(({ id, provider: p }) => ({ id, provider: p }));

        const baseUser = { id: su.id, name, email, provider, providers, identities };
        login(baseUser);

        // Punto DETERMINISTA: toda hidratación de sesión (INITIAL_SESSION en cada apertura,
        // SIGNED_IN, PASSWORD_RECOVERY) pasa por aquí. Reconcilia con el email autoritativo del
        // servidor (getUser), no con session.user.email (JWT persistido, posiblemente antiguo).
        // Cubre el caso multidispositivo aunque A nunca reciba USER_UPDATED/TOKEN_REFRESHED.
        // Parte 1 (reconcilia public.users) + email AUTORITATIVO. Una sola llamada getUser
        // en vuelo; su promesa se reutiliza abajo para dejar el user React con el email real.
        const authEmailP = reconcileEmailFromAuth();

        // Fetch canonical full_name + user_code from public.users — overrides auth metadata
        supabase
          .from('users')
          .select('full_name, user_code, city, email')
          .eq('id', su.id)
          .maybeSingle()
          .then(async ({ data: initialData }) => {
            // For brand-new users the trigger that creates the users row may not
            // have run yet — retry once after a short delay.
            let data = initialData;
            if (!data?.full_name) {
              await new Promise(r => setTimeout(r, 1500));
              const { data: retried } = await supabase
                .from('users')
                .select('full_name, user_code, city, email')
                .eq('id', su.id)
                .maybeSingle();
              data = retried;
              // Sin perfil canónico aún, pero el email autoritativo sí debe aplicarse.
              if (!data?.full_name) { applyAuthoritativeEmail(await authEmailP); return; }
            }

            let userCode = data.user_code || null;
            if (!userCode) {
              userCode = await ensureUserCode(supabase, su.id, data.full_name);
            }

            // If DB has no city yet, promote the onboarding city from localStorage
            // Only read from pichanga_profile if it belongs to this user
            let resolvedCity = data.city || null;
            if (!resolvedCity) {
              try {
                const stored = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
                const localCity = (stored.userId === su.id || !stored.userId) ? (stored.city || null) : null;
                if (localCity) {
                  resolvedCity = localCity;
                  await supabase.from('users').update({ city: localCity }).eq('id', su.id);
                }
              } catch {}
            }

            const canonical = {
              ...baseUser,
              email: (await authEmailP) || baseUser.email, // autoritativo; NO revierte a OLD (si getUser falló, conserva el actual)
              name: data.full_name,
              ...(userCode     && { userCode }),
              ...(resolvedCity && { city: resolvedCity }),
            };
            login(canonical);
            try {
              const stored = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
              stored.userId   = su.id;
              stored.fullName = data.full_name;
              if (userCode)     stored.userCode = userCode;
              if (resolvedCity) stored.city     = resolvedCity;
              localStorage.setItem('pichanga_profile', JSON.stringify(stored));
            } catch {}
          });
      }
      // Complemento en TIEMPO REAL para la sesión ya abierta: si el cambio se confirma mientras
      // la app está activa (sin reload), estos eventos disparan la MISMA reconciliación autoritativa.
      // No es la garantía (esa es getUser en la hidratación), solo evita esperar a la próxima apertura.
      if (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        reconcileEmailFromAuth().then(applyAuthoritativeEmail);
      }
      if (event === 'SIGNED_OUT') {
        setUserState(null);
        removeUser();
        clearUserScopedCache();   // safety net: signout from another tab / token expiry
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ user, login, logout, linkProvider, unlinkProvider }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
