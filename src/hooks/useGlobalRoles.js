import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchMyGlobalRoles, deriveRoleFlags } from '../services/userRolesService';

// Infraestructura de roles globales (captain / captain_gold / algrass_staff / algrass_admin).
// Solo lectura de los roles del usuario autenticado.
export function useGlobalRoles() {
  const { user } = useAuth();
  const [roles, setRoles] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) { setRoles([]); setReady(true); return; }
    setReady(false);
    fetchMyGlobalRoles(user.id).then(r => {
      if (!cancelled) { setRoles(r); setReady(true); }
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  return { roles, ...deriveRoleFlags(roles), ready };
}
