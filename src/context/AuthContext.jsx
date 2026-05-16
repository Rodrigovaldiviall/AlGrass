import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getUser, setUser, removeUser } from '../services/userService';
import { ensureUserCode } from '../utils/format';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => getUser());

  function login(userData) {
    setUserState(userData);
    setUser(userData);
  }

  function logout() {
    setUserState(null);
    removeUser();
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
      if (event === 'SIGNED_IN' && session) {
        const su = session.user;
        const metaName = su.user_metadata?.full_name || su.user_metadata?.name || null;
        const name = metaName || 'Usuario';
        const email = su.email || '';

        // Proveedor principal de la cuenta (el primero con el que se registró).
        const provider = su.app_metadata?.provider || 'email';

        // Lista completa de proveedores vinculados a esta cuenta.
        // Con "Automatic identity linking" activo en Supabase, si el usuario
        // se autenticó con un proveedor diferente al mismo email, Supabase
        // fusionó las cuentas y aquí aparecerán todos los proveedores.
        // Cada identidad: { id, provider, identity_data, created_at, ... }
        const providers = (su.identities ?? []).map(i => i.provider);

        // identities se guarda para permitir unlinkProvider() — necesita el id.
        const identities = (su.identities ?? []).map(({ id, provider: p }) => ({ id, provider: p }));

        const baseUser = { id: su.id, name, email, provider, providers, identities };
        login(baseUser);

        // Fetch canonical full_name + user_code from profiles table — overrides auth metadata
        supabase
          .from('users')
          .select('full_name, user_code, city')
          .eq('id', su.id)
          .maybeSingle()
          .then(async ({ data: initialData, error: rowError }) => {
            console.log('[AuthCity] SIGNED_IN user_id:', su.id);
            console.log('[AuthCity] users row:', initialData ? { full_name: initialData.full_name, city: initialData.city } : null, '| rowError:', rowError?.message ?? null);

            // For brand-new users the trigger that creates the users row may not
            // have run yet — retry once after a short delay.
            let data = initialData;
            if (!data?.full_name) {
              console.log('[AuthCity] no users row yet, retrying in 1.5 s…');
              await new Promise(r => setTimeout(r, 1500));
              const { data: retried, error: retryError } = await supabase
                .from('users')
                .select('full_name, user_code, city')
                .eq('id', su.id)
                .maybeSingle();
              console.log('[AuthCity] retry row:', retried ? { full_name: retried.full_name, city: retried.city } : null, '| retryError:', retryError?.message ?? null);
              data = retried;
              if (!data?.full_name) return;
            }

            let userCode = data.user_code || null;
            if (!userCode) {
              userCode = await ensureUserCode(supabase, su.id, data.full_name);
            }

            // If DB has no city yet, promote the onboarding city from localStorage
            let resolvedCity = data.city || null;
            if (!resolvedCity) {
              try {
                const localCity = JSON.parse(localStorage.getItem('pichanga_profile') || '{}').city || null;
                console.log('[AuthCity] db.city=null | local city:', localCity);
                if (localCity) {
                  resolvedCity = localCity;
                  const { error: cityErr, status } = await supabase
                    .from('users')
                    .update({ city: localCity })
                    .eq('id', su.id);
                  console.log('[AuthCity] city update status:', status, '| error:', cityErr?.message ?? null);
                }
              } catch (e) {
                console.error('[AuthCity] city sync threw:', e);
              }
            } else {
              console.log('[AuthCity] db.city already set:', data.city);
            }

            const canonical = {
              ...baseUser,
              name: data.full_name,
              ...(userCode      && { userCode }),
              ...(resolvedCity  && { city: resolvedCity }),
            };
            login(canonical);
            try {
              const stored = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
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
