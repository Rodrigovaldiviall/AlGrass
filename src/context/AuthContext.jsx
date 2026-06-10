import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getUser, setUser, removeUser } from '../services/userService';
import { ensureUserCode } from '../utils/format';

const AuthContext = createContext(null);

// Keys that belong to the device, not the user — preserved across logout.
const _DEVICE_KEYS = new Set(['algrass_intro_seen', 'pichanga_welcome_seen', 'pichanga_coach_seen']);
// Dynamic key prefixes (uid / gameId suffixes) scrubbed by scan.
const _USER_PREFIXES = ['pf_player_rows_', 'pg_player_rows_', 'pg_waitlist_', 'gd_roster_'];
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

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => getUser());

  function login(userData) {
    setUserState(userData);
    setUser(userData);
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
              if ((count ?? 0) > 0) { console.log('[notif] welcome_message already exists, skipping'); return; }
              supabase.from('notifications').insert({
                recipient_user_id: session.user.id,
                source_type:       'algrass',
                delivery_type:     'automatic',
                category:          'onboarding',
                template_key:      'welcome_message',
                sent_at:           new Date().toISOString(),
              }).then(({ error }) => {
                if (error) console.error('[notif] welcome_message failed:', error);
                else console.log('[notif] welcome_message inserted for', session.user.id);
              });
            });
        }
      }

      // INITIAL_SESSION fires on every page load with the persisted Supabase session —
      // handling it here ensures the React user state is always derived from the live
      // Supabase session, not from a potentially stale pichanga_user localStorage entry.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        const su = session.user;
        const metaName = su.user_metadata?.full_name || su.user_metadata?.name || null;
        const name = metaName || 'Usuario';
        const email = su.email || '';
        const provider = su.app_metadata?.provider || 'email';
        const providers = (su.identities ?? []).map(i => i.provider);
        const identities = (su.identities ?? []).map(({ id, provider: p }) => ({ id, provider: p }));

        const baseUser = { id: su.id, name, email, provider, providers, identities };
        login(baseUser);

        // Fetch canonical full_name + user_code from public.users — overrides auth metadata
        supabase
          .from('users')
          .select('full_name, user_code, city')
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
                .select('full_name, user_code, city')
                .eq('id', su.id)
                .maybeSingle();
              data = retried;
              if (!data?.full_name) return;
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
