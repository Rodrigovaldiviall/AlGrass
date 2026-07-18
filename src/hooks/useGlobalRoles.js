import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchMyGlobalRoles, deriveRoleFlags } from '../services/userRolesService';

// Infraestructura de roles globales (captain / captain_gold / algrass_staff / algrass_admin).
// Solo lectura de los roles del usuario autenticado.
//
// Caché local por usuario: como `user` se hidrata SÍNCRONO desde localStorage, los roles
// cacheados permiten conocer isCaptain/isCaptainGold ya en el PRIMER render (evita el salto
// del bloque de capitán en el checkout mientras se revalida). Siempre se revalida con
// fetchMyGlobalRoles (fuente de verdad: tabla user_roles).
const _rolesKey = (uid) => `pichanga_global_roles_${uid}`;
function _readRolesCache(uid) {
  if (!uid) return null;
  try { const v = JSON.parse(localStorage.getItem(_rolesKey(uid))); return Array.isArray(v) ? v : null; }
  catch { return null; }
}

export function useGlobalRoles() {
  const { user } = useAuth();
  const [roles, setRoles] = useState(() => _readRolesCache(user?.id) ?? []);
  const [ready, setReady] = useState(() => _readRolesCache(user?.id) != null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) { setRoles([]); setReady(true); return; }
    const cached = _readRolesCache(user.id);
    if (cached) { setRoles(cached); setReady(true); } else { setReady(false); }
    fetchMyGlobalRoles(user.id).then(r => {
      if (cancelled) return;
      setRoles(r); setReady(true);
      try { localStorage.setItem(_rolesKey(user.id), JSON.stringify(r)); } catch {}
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  return { roles, ...deriveRoleFlags(roles), ready };
}
