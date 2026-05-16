import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  fetchMyVenueStaff,
  fetchManagedVenues,
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
    console.log('[Staff] refresh() | user?.id:', user?.id ?? 'MISSING');
    if (!user?.id) {
      setReady(true);
      return;
    }

    const [staffRes, venuesRes, gamesRes] = await Promise.allSettled([
      fetchMyVenueStaff(user.id),
      fetchManagedVenues(user.id),
      fetchHostedGames(user.id),
    ]);

    // ── venue_staff ──
    console.log('[Staff] staffRes.status:', staffRes.status);
    if (staffRes.status === 'fulfilled') {
      const { data: rawStaff, error: staffErr } = staffRes.value;
      console.log('[Staff] staffErr:', staffErr?.message ?? null, '| code:', staffErr?.code ?? null);
      console.log('[Staff] rawStaff rows (post-merge):', rawStaff?.length ?? 0, rawStaff);
      if (!staffErr && rawStaff) {
        rawStaff.forEach(r => {
          console.log('[Staff] row → id:', r.id, '| user_id:', r.user_id, '| status:', r.status, '| venues:', r.venues);
        });
        const accepted = rawStaff.filter(r => r.status === 'accepted');
        const pending  = rawStaff.filter(r => r.status === 'pending');
        console.log('[Staff] accepted:', accepted.length, '| pending:', pending.length);
        setAcceptedStaff(accepted);
        setPendingInvites(pending);
        if (pending.length > 0 && shouldAutoShow()) {
          console.log('[Staff] setting modalVisible = true (cooldown passed)');
          setModalVisible(true);
        } else if (pending.length > 0) {
          console.log('[Staff] pending exists but within 24h cooldown — skipping auto-show');
        }
      }
    } else {
      console.error('[Staff] staffRes rejected:', staffRes.reason);
    }

    // ── venues (manager) ──
    console.log('[Staff] venuesRes.status:', venuesRes.status);
    if (venuesRes.status === 'fulfilled') {
      const { data: rawVenues, error: venuesErr } = venuesRes.value;
      console.log('[Staff] venuesErr:', venuesErr?.message ?? null, '| managed venues:', rawVenues?.length ?? 0, rawVenues);
      if (!venuesErr) setManagedVenues(rawVenues ?? []);
    }

    // ── hosted games ──
    if (gamesRes.status === 'fulfilled' && !gamesRes.value.error) {
      setHostedGames(gamesRes.value.data ?? []);
    }

    setReady(true);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    console.log('[Staff] modalVisible changed →', modalVisible, '| pendingInvites:', pendingInvites.length);
  }, [modalVisible, pendingInvites.length]);

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
