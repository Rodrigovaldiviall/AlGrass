import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  fetchMyVenueStaff,
  fetchHostedGames,
  acceptStaffInvite,
  rejectStaffInvite,
} from '../services/venueStaffService';

const StaffContext = createContext(null);

const DISMISS_KEY  = 'staff_invites_last_dismissed_at';
const COOLDOWN_MS  = 24 * 60 * 60 * 1000;

function shouldAutoShow() {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - ts > COOLDOWN_MS;
  } catch {
    return true;
  }
}

export function StaffProvider({ children }) {
  const { user } = useAuth();

  const [acceptedStaff,  setAcceptedStaff]  = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [managedVenues,  setManagedVenues]  = useState([]);
  const [hostedGames,    setHostedGames]    = useState([]);
  const [ready,          setReady]          = useState(false);
  const [modalVisible,   setModalVisible]   = useState(false);

  // Derived capabilities — never persisted, always from live DB relations
  const isVenueStaff   = acceptedStaff.length > 0;
  const isVenueManager = managedVenues.length > 0;
  const isGameHost     = hostedGames.length > 0;

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setReady(true);
      return;
    }

    const [staffRes, gamesRes] = await Promise.allSettled([
      fetchMyVenueStaff(user.id),
      fetchHostedGames(user.id),
    ]);

    if (staffRes.status === 'fulfilled') {
      const { data: rawStaff, error: staffErr } = staffRes.value;
      if (!staffErr && rawStaff) {
        const accepted = rawStaff.filter(r => r.status === 'accepted');
        const pending  = rawStaff.filter(r => r.status === 'pending');
        setAcceptedStaff(accepted);
        setPendingInvites(pending);
        // manager_user_id is now included in venues — derive managed venues without extra query
        // (Supabase trigger guarantees manager_user_id → venue_staff accepted)
        const managed = accepted
          .filter(r => r.venues?.manager_user_id === user.id)
          .map(r => ({ id: r.venue_id, name: r.venues?.name ?? '' }));
        setManagedVenues(managed);
        if (pending.length > 0 && shouldAutoShow()) setModalVisible(true);
      }
    }

    if (gamesRes.status === 'fulfilled' && !gamesRes.value.error) {
      setHostedGames(gamesRes.value.data ?? []);
    }

    setReady(true);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  function dismissModal() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setModalVisible(false);
  }

  async function acceptInvite(rowId) {
    const { error } = await acceptStaffInvite(rowId);
    if (!error) await refresh();
    return { error };
  }

  async function rejectInvite(rowId) {
    const { error } = await rejectStaffInvite(rowId);
    if (!error) await refresh();
    return { error };
  }

  return (
    <StaffContext.Provider value={{
      acceptedStaff, pendingInvites, managedVenues, hostedGames,
      isVenueStaff, isVenueManager, isGameHost,
      ready, modalVisible, setModalVisible, dismissModal,
      acceptInvite, rejectInvite, refresh,
    }}>
      {children}
    </StaffContext.Provider>
  );
}

export const useStaff = () => useContext(StaffContext);
