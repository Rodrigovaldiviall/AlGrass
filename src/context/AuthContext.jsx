import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getUser, setUser, removeUser } from '../services/userService';

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
        const name = su.user_metadata?.full_name
          || su.user_metadata?.name
          || su.email?.split('@')[0]
          || 'Usuario';
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

        login({ name, email, provider, providers, identities });
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
