import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSheetPull } from '../hooks/useSheetPull';
import { useAuth } from '../context/AuthContext';
import { TEXT, SUB, HAIR, ORANGE, SOFT, DANGER, YAPE, BLUE, gameUnavailableCopy } from '../constants';
import I from '../icons';
import { shareOrCopy, buildGameShareUrl } from '../utils/share';
import { addPlayers as addPlayersToRoster, createRoster } from '../services/gameService';
import { supabase } from '../lib/supabase';
import aprobarComprasYape from '../assets/Aprobar compras yape.webp';
import codigoYape from '../assets/Código yape.webp';
import { createReservation, createGamePlayer, createInvitedReservation, validatePromoCode, searchUsers, getWalletBalance } from '../services/reservationService';
import { resolveCaptainGroupAssignment } from '../services/captainGroupService';
import { markWaitlistReserved } from '../services/waitlistService';
import { materializeReservation } from '../services/materializeReservation';
import { createOrder, failOrder, confirmOrder, getOrderStatus } from '../services/orderService';
import { useAppTimings } from '../hooks/useAppTimings';
import SkeletonPill from '../components/SkeletonPill';
import { charge } from '../services/paymentAdapter';
import { uuidv4 } from '../lib/uuid';
import ConfirmedOverlay from '../components/ConfirmedOverlay';
import { getAvatarUrl } from '../utils/avatar';
import { gameStartDate } from '../utils/deriveGameState';
import { useGlobalRoles } from '../hooks/useGlobalRoles';

const ROSTER_KEY = 'pichanga_game_rosters';

function firstName(fullName) {
  return (fullName ?? '').split(' ')[0] || 'Un jugador';
}

function guestNamesText(gs) {
  const names = gs.map(g => firstName(g.name)).filter(Boolean);
  if (!names.length) return 'tus invitados';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}


function getFavorites(paidPlayers) {
  const seen = new Set();
  const result = [];
  for (const e of paidPlayers) {
    if (!seen.has(e.id)) { seen.add(e.id); result.push(e); }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}


// ── Shared primitives ──

function Avatar({ name, hue = 210, size = 44, avatarPath = null, avatarVersion = null }) {
  const imgSrc = avatarPath ? getAvatarUrl(supabase, avatarPath, avatarVersion) : null;
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  if (imgSrc) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(160deg, hsl(${hue} 70% 62%), hsl(${(hue + 30) % 360} 65% 48%))`,
      color: '#fff', fontWeight: 700, fontSize: size * 0.36,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      letterSpacing: -0.2, flexShrink: 0,
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
    }}>
      {initials}
    </div>
  );
}

function UserAvatar({ size = 44 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(160deg, #C9CCD2, #8B8E96)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <circle cx="14.5" cy="4.5" r="2" fill="#fff"/>
        <path d="M9 22l3-7-3-3 5-2 4 4 3 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 14l3-1 4 2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function CtaButton({ onPress, disabled, children }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onPress}
      disabled={!!disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: '100%', height: 54, borderRadius: 18,
        background: disabled ? '#E8E8EC' : ORANGE,
        color: disabled ? '#9A9AA0' : '#1B1B1F',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
        boxShadow: disabled ? 'none' : (pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)'),
        transform: !disabled && pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'transform .12s ease, box-shadow .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
      }}>
      {children}
    </button>
  );
}

function TopBar({ title, onCancel, rightNode }) {
  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
      paddingBottom: 8, paddingLeft: 16, paddingRight: 16, background: '#fff',
    }}>
      <div style={{ height: 36, display: 'flex', alignItems: 'center', position: 'relative' }}>
        <button
          onClick={onCancel}
          style={{ padding: '6px 4px 6px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: TEXT, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          Cancelar
        </button>
        <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>{title}</span>
        </div>
        {rightNode && <div style={{ marginLeft: 'auto' }}>{rightNode}</div>}
      </div>
    </div>
  );
}

// ── PlayerRow ──────────────────────────────────────────────────────────────

function PlayerRow({ p, checked, onToggle, rostered = false }) {
  return (
    <button
      onClick={onToggle}
      style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <Avatar name={p.name} hue={p.hue} size={42} avatarPath={p.avatarPath ?? null} avatarVersion={p.avatarVersion ?? null} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{p.code}</div>
      </div>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        border: `1.6px solid ${checked ? ORANGE : '#C7C7CC'}`,
        // Jugador ya inscrito (no seleccionable) → interior gris para distinguirlo.
        background: checked ? ORANGE : (rostered ? '#E5E5EA' : '#fff'),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
    </button>
  );
}

// ── AddPlayers sub-screen ──────────────────────────────────────────────────

function AddPlayersScreen({ alreadySelected, onCancel, onConfirm, paidPlayers, maxGuests = 99, spotsCount, isInscribed = false, gameId, rosterPlayerIds = new Set(), hostUserId = null }) {
  const { user: authUser } = useAuth();
  const favorites  = getFavorites(paidPlayers);
  const hasAnyData = paidPlayers.length > 0;

  const initIds = new Set(alreadySelected.map(g => g.id));
  const [query, setQuery]             = useState('');
  const [selectedIds, setSelectedIds] = useState(() => initIds);
  const [linkCopied, setLinkCopied]   = useState(false);
  const [dupMsg, setDupMsg]           = useState('');
  const [sbResults, setSbResults]     = useState([]);
  const [sbPlayerMap, setSbPlayerMap] = useState({});

  const q = query.trim().toLowerCase();

  // Reutiliza EXACTAMENTE la misma acción de compartir del botón del header (no es un flujo nuevo).
  const shareInvite = () => shareOrCopy({ url: buildGameShareUrl(gameId, { sharedByUserId: authUser?.id }), onCopied: () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } });
  const linkWordStyle = { color: ORANGE, fontWeight: 700, cursor: 'pointer' };

  useEffect(() => {
    if (!q) { setSbResults([]); return; }
    searchUsers(q, { excludeIds: [...selectedIds] })
      .then(results => {
        setSbResults(results);
        setSbPlayerMap(prev => {
          const next = { ...prev };
          results.forEach(p => { next[p.id] = p; });
          return next;
        });
      })
      .catch(err => console.error('[AddPlayers] searchUsers error:', err));
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortByName = (a, b) => a.name.localeCompare(b.name, 'es');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedRef = useMemo(
    () => Object.values(sbPlayerMap).filter(p => selectedIds.has(p.id)).sort(sortByName).map(p => p.id),
    [q] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sortedRefSet = new Set(sortedRef);

  function toggle(id) {
    if (hostUserId && id === hostUserId) {
      setDupMsg('El organizador no puede ser agregado como jugador.');
      setTimeout(() => setDupMsg(''), 2500);
      return;
    }
    if (rosterPlayerIds.has(id)) {
      setDupMsg('Este jugador ya está inscrito');
      setTimeout(() => setDupMsg(''), 2500);
      return;
    }
    if (!selectedIds.has(id) && selectedIds.size >= maxGuests) {
      setDupMsg('No hay más cupos disponibles');
      setTimeout(() => setDupMsg(''), 2500);
      return;
    }
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < maxGuests) {
        next.add(id);
      }
      return next;
    });
  }

  const allKnownPlayers = { ...Object.fromEntries(alreadySelected.map(p => [p.id, p])), ...Object.fromEntries(favorites.map(p => [p.id, p])), ...sbPlayerMap };

  const topList = q
    ? [
        ...sortedRef.filter(id => selectedIds.has(id)).map(id => allKnownPlayers[id]).filter(Boolean),
        ...[...selectedIds].filter(id => !sortedRefSet.has(id)).map(id => allKnownPlayers[id]).filter(Boolean),
      ]
    : [...selectedIds].map(id => allKnownPlayers[id]).filter(Boolean).sort(sortByName);

  const listBelow = q
    ? sbResults.filter(p => !selectedIds.has(p.id))
    : favorites.filter(p => !selectedIds.has(p.id));

  const noMatchAtAll = q && sbResults.length === 0;

  const selectedPlayers = [...selectedIds].map(id => allKnownPlayers[id]).filter(Boolean);

  const prevIds      = new Set(alreadySelected.map(g => g.id));
  const newCount     = [...selectedIds].filter(id => !prevIds.has(id)).length;
  const removedCount = [...prevIds].filter(id => !selectedIds.has(id)).length;
  const dirty        = newCount > 0 || removedCount > 0;
  const ctaLabel     = newCount > 0 && removedCount === 0
    ? `Agregar ${newCount} ${newCount === 1 ? 'jugador' : 'jugadores'}`
    : dirty ? 'Actualizar selección' : 'Agregar jugadores';

  return (
    <div className="add-players-screen" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <TopBar title="Agregar jugadores" onCancel={onCancel} rightNode={
        gameId ? (
          <button
            onClick={() => shareOrCopy({ url: buildGameShareUrl(gameId, { sharedByUserId: authUser?.id }), onCopied: () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } })}
            style={{ width: 36, height: 36, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
            {I.share(TEXT)}
          </button>
        ) : null
      } />

      {spotsCount != null && (
        <div style={{ padding: '2px 16px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{spotsCount} cupos disponibles</div>
          {!isInscribed && spotsCount > 1 && (
            <div style={{ fontSize: 12, color: SUB }}>
              Solo puedes invitar a {spotsCount - 1} {spotsCount - 1 === 1 ? 'jugador' : 'jugadores'}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '8px 16px 4px' }}>
        <div style={{ height: 44, padding: '0 12px', borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="8" cy="8" r="5.4" stroke={SUB} strokeWidth="1.6"/>
            <path d="M12 12l3.4 3.4" stroke={SUB} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o @ID"
            style={{ flex: 1, minWidth: 0, height: '100%', padding: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: TEXT }}
          />
          {q && (
            <button onClick={() => setQuery('')} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#C4C4CC"/>
                <path d="M5 5l6 6M11 5l-6 6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>

        {topList.length > 0 && (
          <>
            <div style={{ padding: '10px 16px 4px', fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.8" stroke={ORANGE} strokeWidth="1.4"/>
                <path d="M4 7.2l2 2L10 5" stroke={ORANGE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Seleccionados · {topList.length}
            </div>
            {topList.map(p => (
              <PlayerRow key={p.id} p={p} checked={selectedIds.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </>
        )}

        {noMatchAtAll && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
            Ningún jugador coincide con "{query}".
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Compártele el <span onClick={shareInvite} style={linkWordStyle}>link</span> para que se registre.
            </div>
          </div>
        )}

        {q && !noMatchAtAll && listBelow.map(p => (
          <PlayerRow key={p.id} p={p} checked={false} rostered={rosterPlayerIds.has(p.id) || p.id === hostUserId} onToggle={() => toggle(p.id)} />
        ))}

        {q && !noMatchAtAll && (
          <div style={{ padding: '12px 24px 20px', textAlign: 'center', color: SUB, fontSize: 13 }}>
            ¿No lo encuentras?
            <div style={{ marginTop: 2 }}>
              Compártele el <span onClick={shareInvite} style={linkWordStyle}>link</span> para que se registre.
            </div>
          </div>
        )}

        {!q && hasAnyData && listBelow.length > 0 && (
          <>
            <div style={{ padding: '10px 16px 4px', fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M7 1l1.5 3.4 3.7.3-2.7 2.4.8 3.7L7 9l-3.3 1.8.8-3.7L1.8 4.7l3.7-.3L7 1z" fill={ORANGE} stroke={ORANGE} strokeWidth="0.5"/>
              </svg>
              Favoritos
            </div>
            {listBelow.map(p => (
              <PlayerRow key={p.id} p={p} checked={false} rostered={rosterPlayerIds.has(p.id) || p.id === hostUserId} onToggle={() => toggle(p.id)} />
            ))}
          </>
        )}

      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px max(12px, env(safe-area-inset-bottom))' }}>
        <CtaButton onPress={() => onConfirm(selectedPlayers)} disabled={!dirty}>
          {ctaLabel}
        </CtaButton>
      </div>
      {linkCopied && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          Link copiado
        </div>
      )}
      {dupMsg && (
        <div style={{ position: 'fixed', bottom: 140, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {dupMsg}
        </div>
      )}
    </div>
  );
}

// ── PaymentSheet modal ──

function MethodRow({ active, onSelect, accentColor, icon, label, children, reverseExpand = false }) {
  const contentBlock = active && children ? (
    <div style={{
      padding: '4px 14px 14px',
      ...(reverseExpand ? { borderBottom: `1px solid ${HAIR}` } : { borderTop: `1px solid ${HAIR}` }),
    }}>
      {children}
    </div>
  ) : null;
  return (
    <div style={{ marginBottom: 10, borderRadius: 14, border: `1.5px solid ${active ? accentColor : HAIR}` }}>
      {reverseExpand && contentBlock}
      <button
        onClick={onSelect}
        style={{ width: '100%', height: 52, padding: '0 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit' }}>
        {icon}
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1, textAlign: 'left' }}>{label}</span>
        <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? accentColor : '#C7C7CC'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor }} />}
        </div>
      </button>
      {!reverseExpand && contentBlock}
    </div>
  );
}

function PaymentSheet({ amount, currency = 'S/.', label, onClose, onPreCharge, onPaid, onRejected }) {
  const [activeTab, setActiveTab] = useState('yape');
  const [open, setOpen] = useState(false);
  const [cardNum, setCardNum] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [yapePhone, setYapePhone] = useState('');
  const [yapeCode, setYapeCode] = useState('');
  const [paying, setPaying]     = useState('idle');

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const nativeLabel = isIOS ? 'Apple Pay' : 'Google Pay';
  const fmt = n => `${currency} ${Number(n || 0).toFixed(2)}`;
  const amtStr = label ?? fmt(amount);

  const yapeValid = yapePhone.length === 9 && yapeCode.length === 6;
  const cardValid = cardNum.replace(/\s/g, '').length === 16 && cardExp.length === 5 && cardCvc.length === 3 && cardPhone.length === 9;
  const canPay = activeTab === 'native' || (activeTab === 'yape' && yapeValid) || (activeTab === 'card' && cardValid);

  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  });

  function handleClose() {
    if (paying === 'loading' || paying === 'confirming') return;
    setPaying('idle');
    setOpen(false);
    setTimeout(() => onClose?.(), 240);
  }
  // Drag-to-dismiss SOLO en selección de método (paying === 'idle'); deshabilitado en
  // loading/confirming/rejected y bajo cualquier overlay bloqueante.
  const { rootRef, scrollRef, dragY, dragging } = useSheetPull({ onClose: handleClose });
  const dragOn = paying === 'idle';

  async function pay() {
    if (!canPay || paying !== 'idle') return;
    setPaying('loading');
    // HOLD justo antes del cobro (main externo). addGuests/invited → {skip:true} (sin Order).
    // Guarda: una excepción inesperada de onPreCharge NO debe dejar el sheet en 'loading'.
    let pre;
    try {
      pre = await onPreCharge?.(activeTab);
    } catch (e) {
      console.error('[pay] onPreCharge threw:', e);
      setPaying('idle');
      return;
    }
    if (pre?.error) {
      // create_order abortó (NO_CAPACITY, etc.): el padre ya mostró el overlay; cerrar sheet.
      setPaying('idle');
      setOpen(false);
      setTimeout(() => onClose?.(), 240);
      return;
    }
    const orderId = pre?.orderId ?? null;
    setTimeout(() => {
      setPaying('confirming');
      setTimeout(async () => {
        // Seam de pago: paymentAdapter (hoy Math.random). Mañana Culqi sin tocar este flujo.
        // Guarda: una excepción inesperada de charge NO debe dejar el sheet en 'confirming'.
        try {
          const { approved, paymentProof } = await charge({ amount, currency, paymentMethod: activeTab });
          if (approved) {
            setOpen(false);
            setTimeout(() => { setPaying('idle'); onPaid?.(activeTab, paymentProof, orderId); }, 260);
          } else {
            onRejected?.(orderId);
            setPaying('rejected');
          }
        } catch (e) {
          console.error('[pay] charge threw:', e);
          setPaying('idle');
        }
      }, 2200);
    }, 1400);
  }

  function formatCard(v) {
    return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }
  function formatExp(v) {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  }

  const nativeIcon = isIOS ? (
    <svg width="18" height="22" viewBox="0 0 384 512" fill="none">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-16.9 75.8-16.9 31.8 0 48.3 16.9 76.4 16.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" fill="#1B1B1F"/>
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.46c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.57-5.17 3.57-8.82z"/>
      <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C4.305 21.34 8.005 24 12.255 24z"/>
      <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"/>
      <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.25 0-7.95 2.66-9.69 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.71-4.96z"/>
    </svg>
  );

  const cardIcon = (
    <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
      <rect x="1" y="1" width="20" height="14" rx="3" stroke={TEXT} strokeWidth="1.5"/>
      <path d="M1 5h20" stroke={TEXT} strokeWidth="1.5"/>
      <rect x="4" y="9" width="6" height="2" rx="1" fill={TEXT}/>
    </svg>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="sheet-overlay"
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        overflow: 'hidden',
      }}>
      <div className="sheet-panel" ref={dragOn ? rootRef : undefined} style={{
        position: 'relative', background: '#FAFAFA',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.18)',
        transform: open ? `translateY(${dragOn ? dragY : 0}px)` : 'translateY(100%)',
        transition: (dragOn && dragging) ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        maxHeight: '92%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Handle + close */}
        <div style={{ position: 'relative', paddingTop: 8, flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto' }} />
          <button
            onClick={handleClose}
            style={{ position: 'absolute', top: 6, right: 10, width: 32, height: 32, borderRadius: '50%', background: '#fff', border: `1px solid ${HAIR}`, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke={TEXT} strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="no-sb pay-body" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'none', padding: '10px 16px 0' }}>
          <div style={{ paddingBottom: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>Método de pago</div>
            <div style={{ marginTop: 2, fontSize: 13, color: SUB }}>
              Total a pagar <strong style={{ color: TEXT, fontWeight: 700 }}>{amtStr}</strong>
            </div>
          </div>

          {/* 1. Yape */}
          <MethodRow
            active={activeTab === 'yape'}
            onSelect={() => setActiveTab('yape')}
            accentColor={YAPE}
            icon={<span style={{ background: YAPE, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 800, letterSpacing: -0.5 }}>yape</span>}
            label="Paga con Yape"
          >
            <div style={{ marginTop: 6, marginBottom: 6, borderRadius: 10, background: `${YAPE}15`, padding: '7px 12px' }}>
              <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.55 }}>Ingresa a tu Yape, selecciona <strong style={{ color: YAPE }}>"Aprobar compras"</strong>, copia el <strong style={{ color: YAPE }}>"Código de aprobación"</strong> y pégalo aquí.</div>
            </div>
            <div className="pay-shots" style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <div className="pay-shot-box" style={{ flex: 1, padding: 4, borderRadius: 12, background: `${YAPE}18`, border: `1px solid ${YAPE}40`, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <img className="pay-shot-img" src={aprobarComprasYape} alt="Aprobar compras Yape" style={{ width: '100%', height: 'auto', maxHeight: 200, objectFit: 'contain', objectPosition: 'top', display: 'block', borderRadius: 9 }} />
                <span className="pay-tap-aprobar" style={{ position: 'absolute', bottom: '18%', left: '84%', transform: 'translateX(-50%)', fontSize: 18, animation: 'yape-tap 2s ease-in-out infinite', pointerEvents: 'none', userSelect: 'none' }}>👆</span>
              </div>
              <div className="pay-shot-box" style={{ flex: 1, padding: 4, borderRadius: 12, background: `${YAPE}18`, border: `1px solid ${YAPE}40`, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <img className="pay-shot-img" src={codigoYape} alt="Código Yape" style={{ width: '100%', height: 'auto', maxHeight: 200, objectFit: 'contain', objectPosition: 'top', display: 'block', borderRadius: 9 }} />
                <span style={{ position: 'absolute', bottom: '10%', left: '43%', transform: 'translateX(-50%)', fontSize: 18, animation: 'yape-tap 2s ease-in-out 0.4s infinite', pointerEvents: 'none', userSelect: 'none' }}>👆</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', overflow: 'hidden', marginBottom: 8 }}>
              <span style={{ padding: '0 10px 0 14px', fontSize: 13, color: SUB, fontWeight: 600, whiteSpace: 'nowrap', height: 48, display: 'flex', alignItems: 'center', borderRight: `1px solid ${HAIR}` }}>🇵🇪 +51</span>
              <input
                value={yapePhone}
                onChange={e => setYapePhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="Número (9 dígitos)"
                inputMode="numeric"
                style={{ flex: 1, height: 48, padding: '0 12px', background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: TEXT }}
              />
            </div>
            <input
              value={yapeCode}
              onChange={e => setYapeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Código de aprobación (6 dígitos)"
              inputMode="numeric"
              style={{ width: '100%', height: 48, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box' }}
            />
          </MethodRow>

          {/* 2. Tarjeta */}
          <MethodRow
            active={activeTab === 'card'}
            onSelect={() => setActiveTab('card')}
            accentColor={ORANGE}
            icon={cardIcon}
            label="Paga con Tarjeta"
            reverseExpand
          >
            <div style={{ marginTop: 8 }}>
              <input
                value={cardNum}
                onChange={e => setCardNum(formatCard(e.target.value))}
                placeholder="Número de tarjeta"
                inputMode="numeric"
                style={{ width: '100%', height: 48, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <input value={cardExp} onChange={e => setCardExp(formatExp(e.target.value))} placeholder="MM/AA" inputMode="numeric"
                  style={{ flex: 1, minWidth: 0, height: 48, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box' }} />
                <input value={cardCvc} onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="CVC" inputMode="numeric"
                  style={{ width: 80, flexShrink: 0, height: 48, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', overflow: 'hidden' }}>
                <span style={{ padding: '0 10px 0 14px', fontSize: 13, color: SUB, fontWeight: 600, whiteSpace: 'nowrap', height: 48, display: 'flex', alignItems: 'center', borderRight: `1px solid ${HAIR}` }}>🇵🇪 +51</span>
                <input value={cardPhone} onChange={e => setCardPhone(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="Teléfono (9 dígitos)" inputMode="numeric"
                  style={{ flex: 1, height: 48, padding: '0 12px', background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: TEXT }} />
              </div>
            </div>
          </MethodRow>

          {/* 3. Apple Pay / Google Pay */}
          <div className="hide-on-desktop">
            <MethodRow
              active={activeTab === 'native'}
              onSelect={() => setActiveTab('native')}
              accentColor="#1B1B1F"
              icon={nativeIcon}
              label={nativeLabel}
            />
          </div>

          <div style={{ height: 8 }} />
        </div>

        {/* Sticky Pagar footer */}
        <div style={{ padding: '12px 16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', borderTop: `1px solid ${HAIR}`, background: '#FAFAFA', flexShrink: 0 }}>
          <CtaButton onPress={pay} disabled={!canPay || paying !== 'idle'}>
            {paying === 'loading' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Procesando...
              </span>
            ) : `Pagar ${amtStr}`}
          </CtaButton>
        </div>
      </div>

      {(paying === 'confirming' || paying === 'rejected') && (
        <div className="sheet-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 201,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: paying === 'rejected' ? '#fff' : 'rgba(10,10,15,0.88)',
          padding: '0 32px',
        }}>
          {paying === 'confirming' ? (
            <>
              <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.2)', borderTop: '4px solid #fff', animation: 'spin 0.9s linear infinite', marginBottom: 28 }} />
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3 }}>
                Estamos confirmando tu reserva...
              </div>
              <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
                No cierres esta pantalla.
              </div>
            </>
          ) : (
            <>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FCEAEB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={DANGER} strokeWidth="1.8"/>
                  <path d="M15 9l-6 6M9 9l6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.4, textAlign: 'center' }}>
                Pago rechazado
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
                No se pudo procesar tu pago. Verifica tus datos e inténtalo de nuevo.
              </div>
              <div style={{ marginTop: 28, width: '100%', maxWidth: 320 }}>
                <CtaButton onPress={() => setPaying('idle')}>
                  Reintentar pago
                </CtaButton>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConfirmReservation screen ──────────────────────────────────────────────

// Selector de lectura del snapshot V6 (privado a este archivo). Con referral usa
// el gemelo por usuario (sharedByUserId); sin referral, la RPC estándar. Su única
// responsabilidad es elegir la RPC y devolver el mismo _slotRes. Nada más.
async function loadSlotSnapshot(gameId, referral) {
  const { data } = referral != null
    ? await supabase.rpc('get_slot_reservation_for_user', { p_game_id: gameId, p_user_id: referral })
    : await supabase.rpc('get_slot_reservation', { p_game_id: gameId });
  return data;
}

// ── Cache local de "Gestionar mi lista" (SOLO percepción de carga) ───────────
// Mismo patrón que gd_roster_ / pf_player_rows_ (sessionStorage, {data, ts}, TTL,
// aislado por usuario en la clave). Guarda la ÚLTIMA lista conocida (rows + snapshot R1)
// para pintar al instante al reabrir. NUNCA es autoridad: el fetch de fondo la
// sobrescribe y el backend (reserve_slots) sigue validando cupos/capacidad.
const ARMA_CACHE_TTL = 15 * 60 * 1000;
const _armaKey = (gameId, uid) => `cr_arma_${gameId}_${uid}`;
function readArmaCache(gameId, uid) {
  if (!gameId || !uid) return null;
  try {
    const c = JSON.parse(sessionStorage.getItem(_armaKey(gameId, uid)));
    if (!c || !c.ts || Date.now() - c.ts > ARMA_CACHE_TTL) return null;
    return { rows: c.rows ?? [], r1: c.r1 ?? null };
  } catch { return null; }
}
function writeArmaCache(gameId, uid, rows, r1) {
  if (!gameId || !uid) return;
  try { sessionStorage.setItem(_armaKey(gameId, uid), JSON.stringify({ rows, r1, ts: Date.now() })); } catch { /* no-op */ }
}
function clearArmaCache(gameId, uid) {
  if (!gameId || !uid) return;
  try { sessionStorage.removeItem(_armaKey(gameId, uid)); } catch { /* no-op */ }
}
// Semilla del contador desde el snapshot R1: ON con N = reserved_slots_total si la R1
// propia está activa (>0). Sin recálculo: solo lee el estado ya persistido.
function _r1Seed(r1) {
  const on = !!(r1?.has_reservation && r1?.status === 'active' && (r1?.reserved_slots_total ?? 0) > 0);
  return { on, n: on ? r1.reserved_slots_total : 0 };
}

// Skeleton SOLO de la LISTA dinámica (roster) de "Gestionar mi lista". El contenido fijo
// —TopBar (Cancelar / Gestionar mi lista), nombre del venue, fecha/hora y el encabezado
// "Arma la lista"— es estático (viene de `game`) y se pinta REAL desde el primer frame; NO
// se simula aquí. Reproduce el layout del bloque real de la lista (contador, resumen, filas)
// con sus mismos paddings, usando el pulse gris de SkeletonPill.
function ArmaListSkeleton() {
  const bar = (w, h, r = 8, extra) => <SkeletonPill className="" style={{ width: w, height: h, borderRadius: r, minWidth: 0, ...extra }} />;
  const circle = (d) => <SkeletonPill className="" style={{ width: d, height: d, borderRadius: '50%', minWidth: 0 }} />;
  const rowSkel = (i) => (
    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
      {circle(44)}
      <div style={{ flex: 1 }}>{bar(120, 15)}</div>
      {bar(64, 16, 999)}
    </div>
  );
  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '6px 0' }}>
        {circle(34)}{bar(30, 24)}{circle(34)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>{bar(230, 13)}</div>
      <div style={{ height: 1, background: HAIR, margin: '4px 0' }} />
      {[0, 1, 2].map(rowSkel)}
    </div>
  );
}

export default function ConfirmReservation() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { user: authUser } = useAuth();
  const game = state?.game;
  // Referral (?ref del link, stash en localStorage por partido). sharedByUserId o null.
  const referral = state?.referral ?? null;
  const user = state?.user ?? { name: 'Usuario', email: 'usuario@email.com' };
  // Canonical display name: DB-fetched name from AuthContext takes precedence over navigation state
  const canonicalName = authUser?.name || user.name;

  const [selfAvatar, setSelfAvatar] = useState({ path: null, version: null, hue: null });
  useEffect(() => {
    if (!authUser?.id || !supabase) return;
    supabase.from('users').select('avatar_path, avatar_updated_at, avatar_hue')
      .eq('id', authUser.id).maybeSingle()
      .then(({ data }) => {
        if (data) setSelfAvatar({ path: data.avatar_path ?? null, version: data.avatar_updated_at ? new Date(data.avatar_updated_at).getTime() : null, hue: data.avatar_hue ?? null });
      });
  }, [authUser?.id]); // eslint-disable-line

  const [guests, setGuests]         = useState([]);
  const [subView, setSubView]       = useState('confirm');
  const [payOpen, setPayOpen]       = useState(false);
  const [paidPlayers, setPaidPlayers] = useState([]);
  useEffect(() => {
    if (!authUser?.id || !supabase) return;
    supabase
      .from('game_players')
      .select('user_id')
      .eq('payer_id', authUser.id)
      .neq('user_id', authUser.id)
      .then(async ({ data }) => {
        const ids = [...new Set((data ?? []).map(r => r.user_id))];
        if (!ids.length) return;
        const { data: users } = await supabase
          .from('users_public')
          .select('id, full_name, user_code, avatar_hue, avatar_path, avatar_updated_at')
          .in('id', ids);
        const result = (users ?? []).map(u => ({
          id:            u.id,
          name:          u.full_name || '',
          code:          u.user_code ? `@${u.user_code}` : '',
          hue:           u.avatar_hue ?? ([...(u.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
          avatarPath:    u.avatar_path    ?? null,
          avatarVersion: u.avatar_updated_at ? new Date(u.avatar_updated_at).getTime() : null,
        }));
        setPaidPlayers(result);
      });
  }, [authUser?.id]); // eslint-disable-line

  const reservationTs               = useRef(Date.now());

  useEffect(() => {
    getWalletBalance()
      .then(balance => setCreditBalance(Math.max(0, balance)))
      .finally(() => setCreditLoading(false));
  }, []);

  const [promoOpen, setPromoOpen]       = useState(false);
  const [promoInput, setPromoInput]     = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoError, setPromoError]     = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [freeConfirming, setFreeConfirming] = useState(false);
  // Compartir/copiar el link del partido (icono del TopBar + cupo reservado en "Gestionar mi lista").
  const [linkCopied, setLinkCopied] = useState(false);
  const _flashCopied = () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); };
  const _gameLink = () => buildGameShareUrl(game?.id, { sharedByUserId: authUser?.id });
  const shareGameLink = () => shareOrCopy({ url: _gameLink(), onCopied: _flashCopied });
  const copyGameLink = () => { try { navigator.clipboard?.writeText(_gameLink()).then(_flashCopied).catch(() => {}); } catch { /* sin portapapeles */ } };
  const [capacityError, setCapacityError]   = useState(null);
  // "NO SE REALIZÓ NINGÚN COBRO" solo es verdad si el error ocurrió en create_order
  // (pre-charge): paymentAdapter.charge aún no corrió. Para errores de confirm_order
  // (post-charge) queda false y la frase NO se muestra.
  const [noChargeYet, setNoChargeYet]       = useState(false);
  // Confirmación de la Order: un ÚNICO timer de polling (pollTimerRef), un guard de
  // "ya resuelto" (evita navegación/terminal duplicados) y un guard de montaje (evita
  // setState/navigate tras unmount). El poll consulta SIEMPRE el MISMO orderId.
  const pollTimerRef        = useRef(null);
  const checkoutResolvedRef = useRef(false);
  const mountedRef          = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, []);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [creditLoading, setCreditLoading]   = useState(true);
  const { isCaptain, isCaptainGold } = useGlobalRoles();
  const { captainReleaseHours, captainGoldReleaseHours } = useAppTimings();   // app_settings (null = reservar cerrado)
  // CASO B — cache local (SOLO percepción): última "Gestionar mi lista" conocida, leída de
  // forma SÍNCRONA para sembrar el estado inicial → pinta al instante sin blanco/skeleton.
  // NO es autoridad: el fetch de fondo la sobrescribe y reconcilia (ver efecto de carga).
  // _armaModeInit refleja armaListaMode (definido más abajo) solo para el momento de init.
  const _armaModeInit = (isCaptain || isCaptainGold) && (game?.addGuestsMode ?? false) && game?.source !== 'campo' && game?.type !== 'rental';
  const _armaInit     = _armaModeInit ? readArmaCache(game?.id, authUser?.id) : null;
  const _armaSeedInit = _armaInit ? _r1Seed(_armaInit.r1) : null;
  const [reservedSlots, setReservedSlots] = useState(_armaSeedInit?.on ? _armaSeedInit.n : 0);
  const [armaLista, setArmaLista] = useState(!!_armaSeedInit?.on); // "Arma la lista" ON/OFF (reservedSlots = N total)
  const [lastN, setLastN] = useState(0);             // N recordado al apagar el toggle (misma sesión)

  const [confirmedPlayerIds, setConfirmedPlayerIds] = useState(new Set());
  useEffect(() => {
    const gid = game?.id;
    if (!supabase || !gid || game?.type === 'rental') return;
    supabase.from('game_players').select('user_id').eq('game_id', gid).eq('status', 'confirmed')
      .then(({ data }) => { setConfirmedPlayerIds(new Set((data || []).map(r => r.user_id))); });
  }, [game?.id]);
  const rosterPlayerIds = confirmedPlayerIds;

  // Shared Link de OTRO capitán: snapshot del capitán del link (para desglosar en el
  // mensaje de disponibilidad "públicos vs reservados del capitán") + su @código.
  const [refSlot, setRefSlot] = useState(null);
  const [refCode, setRefCode] = useState('');
  useEffect(() => {
    const gid = game?.id;
    if (!supabase || !gid || game?.type === 'rental' || referral == null || referral === authUser?.id) return;
    loadSlotSnapshot(gid, referral).then((d) => setRefSlot(Array.isArray(d) ? d[0] : d));
    supabase.from('users_public').select('user_code').eq('id', referral).maybeSingle()
      .then(({ data }) => setRefCode(data?.user_code ? `@${data.user_code}` : ''));
  }, [game?.id, referral, authUser?.id]); // eslint-disable-line

  const isCampo       = game?.source === 'campo';
  const isRental      = game?.type === 'rental';
  const addGuestsMode = game?.addGuestsMode ?? false;
  const invitedMode   = game?.invitedMode   ?? false;

  // ── "Gestionar mi lista" — el capitán entra por el MISMO addGuestsMode y, encima del
  // selector de invitados, aparece el bloque "Arma la lista" (mismo diseño del checkout).
  // Toda la interacción (switch / N / lista) es estado LOCAL: no escribe en Supabase hasta
  // Guardar/confirmar. NO es un modo nuevo: es addGuestsMode + rol capitán.
  const armaListaMode = (isCaptain || isCaptainGold) && addGuestsMode && !isCampo && !isRental;
  const _capId = authUser?.id;
  const [listRoster, setListRoster] = useState(_armaInit?.rows ?? []);        // confirmed del partido (clasificación)
  const [listR1, setListR1] = useState(_armaInit?.r1 ?? null);                // snapshot get_slot_reservation (R1 propia)
  const [listLoaded, setListLoaded] = useState(_armaInit != null);           // cache → pinta ya; sin cache → skeleton
  const [promotedLinkIds, setPromotedLinkIds] = useState([]); // links subidos a Lista con la flecha ↑
  // Si el cache ya sembró (Caso B), _listSeeded=true → el fetch NO re-siembra, RECONCILIA.
  const _listSeeded = useRef(_armaInit != null);
  const _cacheSeed = useRef(_armaSeedInit);   // {on, n} sembrado por el cache (reconciliar sin pisar edits)
  useEffect(() => {
    const gid = game?.id;
    if (!supabase || !gid || !armaListaMode) return;
    (async () => {
      try {
        const snap = await loadSlotSnapshot(gid, referral);
        const r1 = Array.isArray(snap) ? snap[0] : snap;
        const { data: players } = await supabase.from('game_players')
          .select('id, user_id, payer_id, status, joined_at, game_slot_reservation_id, counts_reserved_slot')
          .eq('game_id', gid).eq('status', 'confirmed');
        const rows = players || [];
        const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
        const byId = {};
        if (ids.length) {
          const { data: us } = await supabase.from('users_public')
            .select('id, full_name, user_code, avatar_hue, avatar_path, avatar_updated_at').in('id', ids);
          (us || []).forEach(u => { byId[u.id] = u; });
        }
        const authRows = rows.map(r => { const u = byId[r.user_id] || {}; return { ...r, ...u, _av: u.avatar_updated_at ? new Date(u.avatar_updated_at).getTime() : null }; });
        setListRoster(authRows);           // AUTORITATIVO: siempre gana sobre el cache
        setListR1(r1 || null);
        writeArmaCache(gid, _capId, authRows, r1 || null);   // refresca cache (solo percepción)
        // Semilla / reconciliación del contador. Caso A (sin cache): semilla desde el snapshot
        // AUTORITATIVO (como antes). Caso B (cache ya sembró): el autoritativo GANA si el usuario
        // no tocó (el estado sigue igual a la semilla del cache).
        const { on: _authOn, n: _authN } = _r1Seed(r1);
        if (!_listSeeded.current) {
          _listSeeded.current = true;
          if (_authOn) { setReservedSlots(_authN); setArmaLista(true); }
        } else if (_cacheSeed.current) {
          const seed = _cacheSeed.current; _cacheSeed.current = null;
          setReservedSlots(prev => (prev === seed.n ? _authN : prev));
          setArmaLista(prev => (prev === seed.on ? _authOn : prev));
        }
      } finally {
        setListLoaded(true); // recién aquí se muestra la pantalla (ya sembrada y clasificada)
      }
    })();
  }, [game?.id, armaListaMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clasificación (solo confirmed). myR1Id = gsr de mi propia fila (V14 lo fija al crear la R1).
  const _myR1Id = listRoster.find(p => p.user_id === _capId)?.game_slot_reservation_id ?? null;
  const _directosAll = listRoster.filter(p => p.payer_id === _capId && p.user_id !== _capId);
  // Directos EXISTENTES que van/están en mi lista: gsr NULL (se adoptarán) o ya en mi R1.
  const directosLista = _directosAll
    .filter(p => p.game_slot_reservation_id == null || p.game_slot_reservation_id === _myR1Id)
    .sort((a, b) => (a.joined_at || '').localeCompare(b.joined_at || ''));
  // Miembros que entraron por link (gsr = mi R1, no titular, no directo). Orden: los subidos con
  // la flecha ↑ primero (en orden de promoción), luego el resto por joined_at.
  const _linkAll = listRoster
    .filter(p => _myR1Id && p.game_slot_reservation_id === _myR1Id && p.user_id !== _capId && p.payer_id !== _capId);
  const _linkPromoted = promotedLinkIds.map(id => _linkAll.find(p => p.id === id)).filter(Boolean);
  const linkMembers = [
    ..._linkPromoted,
    ..._linkAll.filter(p => !promotedLinkIds.includes(p.id)).sort((a, b) => (a.joined_at || '').localeCompare(b.joined_at || '')),
  ];
  // Otros inscritos: confirmed que no son titular, ni mis directos-de-lista, ni miembros de mi R1.
  // Incluye a un directo mío que ya está en OTRA R1 (payer=yo, gsr≠mi R1) → etiqueta "Otro grupo".
  const otrosInscritos = listRoster.filter(p => p.user_id !== _capId
    && !(p.payer_id === _capId && (p.game_slot_reservation_id == null || p.game_slot_reservation_id === _myR1Id))
    && !(_myR1Id && p.game_slot_reservation_id === _myR1Id));
  // R1 propia activa al ENTRAR (para saber si OFF+Guardar debe liberar).
  const _entryR1Active = !!(listR1?.has_reservation && listR1?.status === 'active');
  // "Sucio" (habilita Guardar cambios sin invitados) = cambió N estando ON, o pasé ON→OFF
  // teniendo una R1 activa al entrar (liberar).
  const _listDirty = armaListaMode && guests.length === 0 && (
    (armaLista && reservedSlots !== (listR1?.reserved_slots_total ?? 0))
    || (!armaLista && _entryR1Active)
  );

  const maxNewGuests  = game?.maxNewGuests  ?? 99;
  const rawSpots      = game?.openSpots;
  // Presupuesto de disponibilidad pública compartido entre invitados y reserva de cupos.
  // Titular checkout: el titular ocupa 1 → presupuesto = public_available (rawSpots) − 1.
  // addGuests/invited: titular ya inscrito → presupuesto = public_available (maxNewGuests).
  const spotBudget    = (addGuestsMode || invitedMode) ? maxNewGuests : (rawSpots != null ? Math.max(0, rawSpots - 1) : undefined);
  // FUENTE ÚNICA del máximo: presupuesto − lo que consume el OTRO selector.
  const maxSelectable = (otherCount) => spotBudget == null ? undefined : Math.max(0, spotBudget - otherCount);
  // piso de N: titular + invitados directos (existentes de mi lista + los nuevos de esta edición).
  const listFloor     = 1 + (armaListaMode ? directosLista.length : 0) + guests.length;
  // Piso MÍNIMO del contador: al armar la lista se reservan al menos 2 (titular + 1 cupo), aunque
  // estés solo. Con invitados el piso real ya es ≥2. No afecta al conteo de "pre-inscritos" ni a
  // los cupos vacíos (esos siguen usando listFloor real).
  const listFloorMin  = Math.max(listFloor, 2);
  // Con Arma la lista ON, N (reservedSlots) YA incluye titular+invitados; el cap de invitados
  // no debe descontar N (los invitados llenan cupos de N o suben N). OFF: comportamiento actual.
  const guestSlots    = maxSelectable(armaLista ? 0 : reservedSlots);   // máx invitados
  // Reserva de cupos (nueva R1): SOLO consume cupos PÚBLICOS libres. Al llegar por Shared
  // Link de otro usuario, rawSpots incluye el remaining del capitán (válido para titular +
  // invitados); el stepper de cupos se acota ADEMÁS al pool público (refSlot.pool = la X del
  // texto). Mientras refSlot carga (_refPending) el stepper queda deshabilitado; no se asume 0.
  const _inLink       = referral != null && referral !== authUser?.id;
  const _refPending   = _inLink && refSlot == null;
  const reservedMax   = _inLink
    ? (_refPending ? undefined : Math.min(maxSelectable(guests.length) ?? (refSlot.pool ?? 0), refSlot.pool ?? 0))
    : maxSelectable(guests.length);   // máx reserva de cupos (descuenta invitados)
  const displaySpots  = guestSlots;
  // Caso de negocio "solo queda el cupo del propio titular": el partido no tiene sitio para
  // NADIE más allá del titular (spotBudget = rawSpots − 1 = 0). Es INDEPENDIENTE de los invitados
  // seleccionados. NO usar reservedMax aquí: reservedMax también llega a 0 cuando los invitados
  // consumen el presupuesto (aunque sí queden cupos), y ese NO es este caso.
  const onlyTitularSpot = spotBudget != null && spotBudget <= 0;
  const spotsLabel    = (() => {
    if (addGuestsMode || invitedMode) {
      if (displaySpots === undefined) return null;
      if (displaySpots === 0) return 'No quedan más cupos disponibles';
      return `Solo ${displaySpots === 1 ? 'queda 1 cupo disponible' : `quedan ${displaySpots} cupos disponibles`}`;
    }
    if (rawSpots == null) return null;
    // Escenario: capitán que llega por Shared Link de OTRO usuario. SOLO en ese
    // escenario, y si hay cupos del capitán del link (Z>0), se desglosa el total en
    // (públicos + del capitán del link @código); si Z=0 cae al mensaje normal.
    if (referral != null && referral !== authUser?.id && (isCaptain || isCaptainGold)) {
      const _refRemaining = refSlot?.effective_reserved_slots_remaining ?? 0;
      if (_refRemaining > 0) {
        const _pub  = refSlot?.pool ?? 0;
        const _tot  = _pub + _refRemaining;
        const _head = _tot === 1 ? 'queda 1 cupo disponible' : `quedan ${_tot} cupos disponibles`;
        return `Solo ${_head} (${_pub} públicos y ${_refRemaining} de ${refCode})`;
      }
    }
    if (rawSpots === 0) return 'No quedan más cupos disponibles';
    return `Solo ${rawSpots === 1 ? 'queda 1 cupo disponible' : `quedan ${rawSpots} cupos disponibles`}`;
  })();
  const unitPrice = game?.priceNumber ?? 0;
  const [creditBalance, setCreditBalance] = useState(0);
  const currency  = game?.currency ?? 'S/.';
  const fmt = n => `${currency} ${Number(n || 0).toFixed(2)}`;

  const titularNet   = unitPrice - (promoApplied?.discount ?? 0);
  const guestsTotal  = guests.length * unitPrice;
  const subtotal     = invitedMode ? 0 : addGuestsMode ? Math.max(0, guestsTotal) : Math.max(0, titularNet + guestsTotal);
  const creditApplied = invitedMode ? 0 : Math.min(creditBalance, subtotal);
  const total        = invitedMode ? 0 : Math.max(0, subtotal - creditApplied);

  // Reserva de cupos (UX de checkout para capitanes). releaseHours desde app_settings según rol
  // (SIN fallback 24/48): null ⇒ reservar CERRADO. 0 es VÁLIDO (== null distingue "no disponible").
  const releaseHours = isCaptainGold ? captainGoldReleaseHours : captainReleaseHours;
  // Misma regla temporal que GameDetail: dentro de esa ventana no se crea/modifica reserva de
  // cupos. El backend (reserve_slots) sigue siendo la verdad.
  const _slotGameStart = gameStartDate(game?.dateKey, game?.time24);
  const slotReservationClosed = releaseHours == null || (!!_slotGameStart && Date.now() >= _slotGameStart.getTime() - releaseHours * 3600_000);
  // Toggle "Arma la lista": armar la lista (titular + invitados YA existentes) no
  // consume cupos nuevos, así que se permite encender el switch aunque no queden
  // cupos, siempre que ya haya lista (listFloor>1 = titular + al menos 1 invitado).
  // Solo se bloquea sin invitados y sin cupos. Los steppers +/- siguen respetando
  // onlyTitularSpot (no se pueden añadir cupos vacíos sin disponibilidad).
  const armaListToggleDisabled = slotReservationClosed || (onlyTitularSpot && listFloor <= 1);
  const captainColor = isCaptainGold ? '#F5B301' : '#E5383B';
  // Arma la lista: ON pone N = max(piso, último N); OFF apaga la reserva (reservedSlots=0) y recuerda N.
  function toggleArmaLista() {
    if (armaLista) { setLastN(reservedSlots); setReservedSlots(0); setArmaLista(false); }
    else { setReservedSlots(Math.max(listFloorMin, lastN)); setArmaLista(true); }
  }
  // Agregar un invitado sube N automáticamente si el nuevo piso lo supera; quitar NO baja N.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (armaLista && reservedSlots < listFloorMin) setReservedSlots(listFloorMin);
  }, [armaLista, reservedSlots, listFloorMin]);
  const emptySlots = armaLista ? Math.max(0, reservedSlots - listFloor) : 0; // cupos vacíos de la Lista
  const stepBtn = (onClick, disabled, plus) => (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 32, height: 32, borderRadius: '50%', border: `1.6px solid ${disabled ? '#D6D6DC' : BLUE}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: disabled ? 0.5 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d={plus ? 'M8 4v8M4 8h8' : 'M4 8h8'} stroke={disabled ? '#9A9AA0' : BLUE} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    </button>
  );

  const unitStr  = fmt(unitPrice);
  const totalStr = (addGuestsMode || invitedMode)
    ? fmt(total)
    : (promoApplied || guests.length > 0 || creditApplied > 0) ? fmt(total) : unitStr;
  const seats = (addGuestsMode || invitedMode) ? guests.length : 1 + guests.length;

  async function applyCode() {
    if (!promoInput.trim() || promoLoading) return;
    setPromoLoading(true);
    const result = await validatePromoCode(promoInput, unitPrice, game?.type ?? null, authUser?.id ?? null, game?.city ?? null);
    setPromoLoading(false);
    if (result.error === 'wrong_type')         { setPromoApplied(null); setPromoError('Este código no aplica para este tipo de reserva.'); return; }
    if (result.error === 'city_not_allowed')   { setPromoApplied(null); setPromoError('Esta promoción no está disponible en esta ciudad.'); return; }
    if (result.error === 'not_started')        { setPromoApplied(null); setPromoError('Esta promoción todavía no está disponible.'); return; }
    if (result.error === 'limit_reached')      { setPromoApplied(null); setPromoError('Esta promoción ya alcanzó su límite de usos.'); return; }
    if (result.error === 'limit_reached_user') { setPromoApplied(null); setPromoError('Ya usaste esta promoción el máximo de veces.'); return; }
    if (result.error) { setPromoApplied(null); setPromoError('Código no válido'); return; }
    setPromoApplied({ kind: result.discount_type, value: result.value, discount: result.discount, code: result.code, promoCodeId: result.promoCodeId });
    setPromoError('');
  }

  function handleConfirm() {
    setNoChargeYet(false);   // se pondrá true solo si create_order (pre-charge) rechaza
    if (!invitedMode && game?.hostUserId && authUser?.id && game.hostUserId === authUser.id) return;
    if (invitedMode) {
      if (!guests.length) return;
      setFreeConfirming(true);
      payWithCredit('invited');   // invitación gratis del HOST → misma tubería Orders
      return;
    }
    if (total === 0) {
      // 100% crédito/gratis → pasa por Orders (create_order → confirm_order modo
      // credit) ANTES de debitar/materializar: flujo PRINCIPAL y addGuests CON
      // invitados. addGuests SIN invitados (solo ajuste de R1, sin pago) conserva su
      // camino actual (reserve_slots directo).
      setCreditLoading(true);
      setTimeout(() => {
        setCreditLoading(false);
        setFreeConfirming(true);
        setTimeout(() => {
          if (addGuestsMode && guests.length === 0) handlePaid();
          else payWithCredit();
        }, 1800);
      }, 1400);
      return;
    }
    setPayOpen(true);
  }

  // ── REGLA CONGELADA — FUENTE ÚNICA del snapshot del main flow ─────────────────
  // buildMainSnapshot() es la ÚNICA función que construye el objeto snapshot del main
  // flow. Ningún otro archivo/función/rama puede reensamblarlo a mano.
  //   · Interno: se pasa directo a materializeReservation.
  //   · Externo: congela financial_snapshot en create_order.
  //   · confirm_order consume ese snapshot serializado TAL CUAL (no recomputa nada).
  // Todo campo nuevo del snapshot se añade SOLO aquí.
  function buildMainSnapshot(paymentMethod) {
    const noTitular = addGuestsMode || invitedMode;   // operaciones sin titular NUEVO
    return {
      gameId: game?.id, gameType: game?.type,
      unitPrice: invitedMode ? 0 : unitPrice,
      promoCode: promoApplied?.code ?? null, promoCodeId: promoApplied?.promoCodeId ?? null,
      promoDiscount: invitedMode ? 0 : (promoApplied?.discount ?? 0),
      totalAmount: invitedMode ? 0 : total, subtotalAmount: invitedMode ? 0 : subtotal,
      playersCount: noTitular ? guests.length : (isRental ? 1 : 1 + guests.length),
      guestTotal: invitedMode ? 0 : (isRental ? 0 : guestsTotal),
      paymentMethod, creditApplied: invitedMode ? 0 : creditApplied, source: game?.source ?? 'match',
      // addGuests: SIN titular (ya inscrito) y referral = payer → create_order acredita la
      // R1 PROPIA del capitán (mismo mecanismo que el Shared Link).
      // invitedMode: HOST invita gratis → SIN titular, invited=true (confirm_order valida
      // host y NO toca wallet), TODO importe = 0 (sin movimiento económico). El host no tiene
      // R1 → los invitados salen de público. referral = host es inocuo (acredita 0).
      titular: !noTitular,
      invited: invitedMode,
      guests, reservedSlots: invitedMode ? 0 : reservedSlots,
      referral: noTitular ? (authUser?.id ?? null) : referral,
      titularNet: invitedMode ? 0 : titularNet, hostUserId: game?.hostUserId ?? null,
      venueId: game?.venueId ?? null, releaseHours, payerName: authUser?.name,
    };
  }

  // Claim del HOLD para create_order. create_order hace v_units = titular + guests +
  // reserved_slots, así que reserved_slots debe ser SOLO los cupos VACÍOS adicionales
  // (emptySlots = N − listFloor), NUNCA el N total (que ya incluye titular+invitados)
  // → evita el doble conteo que provocaba NO_CAPACITY en partidos ajustados.
  // financial_snapshot.reservedSlots sigue siendo el N TOTAL objetivo (materialize/
  // reserve_slots lo necesitan). addGuests: SIN titular y reserved_slots=0 → claimed_
  // units = nº invitados; create_order acredita la R1 propia vía referral (= payer) y
  // los vacíos ya están retenidos por esa R1. Rental: 1 unidad.
  function buildClaimComposition() {
    if (isRental) return { titular: true };
    // addGuests e invitedMode: SIN titular, reserved_slots=0 → claimed_units = nº invitados.
    if (addGuestsMode || invitedMode) return { titular: false, guests, reserved_slots: 0 };
    return { titular: true, guests, reserved_slots: emptySlots };
  }

  // Cierre COMPARTIDO de una reserva confirmada del main flow (interno y externo):
  // waitlist + limpieza de caches + navegación. Mismo confirmedGame para ambos caminos.
  function finishConfirmedNavigation() {
    markWaitlistReserved(authUser?.id, game?.id);
    try { sessionStorage.removeItem(`gd_roster_${game?.id}`); } catch {}
    try { sessionStorage.removeItem(`pg_player_rows_${authUser?.id}`); } catch {}
    if (game?.id) {
      try {
        const shown = JSON.parse(localStorage.getItem('pichanga_shown_confirmations')) || {};
        delete shown[game.id];
        localStorage.setItem('pichanga_shown_confirmations', JSON.stringify(shown));
      } catch {}
    }
    try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
    navigate('/profile', { state: { confirmedGame: {
      id:           game?.id,
      field:        game?.field,
      date:         game?.date,
      dateKey:      game?.dateKey   ?? null,
      time:         game?.time,
      ampm:         game?.ampm      ?? null,
      time24:       game?.time24    ?? null,
      durationMin:  game?.durationMin ?? null,
      format:       game?.format || '7v7',
      amount:       total,
      price:        game?.price,
      source:       game?.source,
      gameType:     game?.type ?? null,
      unitPrice:    unitPrice,
      promoDiscount: promoApplied?.discount ?? 0,
      creditApplied: creditApplied,
      discount:     (promoApplied?.discount ?? 0) + creditApplied,
      guestsCount:  guests.length,
      guestsTotal:  guestsTotal,
      reservedSlots: reservedSlots,
      releaseHours: releaseHours,
    }}});
  }

  // ── Camino EXTERNO (total>0: main flow y addGuests con invitados) ─────────────
  // createOrder(HOLD) → paymentAdapter.charge → confirmOrder → finishConfirmedNavigation.
  // addGuests usa una Order NUEVA del mismo game (titular:false); invited sigue sin Order.
  //
  // onPreCharge: adquiere el HOLD JUSTO antes del cobro, con el método ya elegido.
  // create_order es el ÚNICO responsable del HOLD.
  // Traduce el error de create_order al token del overlay capacityError (fuente única).
  // NO_CAPACITY / INSUFFICIENT_PUBLIC_SLOTS → falta de cupos. Estados no reservables del
  // game → GAME_UNAVAILABLE. ORDER_EXPIRED no nace en create_order (viene de confirm_order).
  function reserveErrorToken(msg) {
    const m = msg ?? '';
    if (m.includes('INSUFFICIENT_PUBLIC_SLOTS')) return 'RESERVED_SLOTS_UNAVAILABLE';
    if (m.includes('NO_CAPACITY')) return game?.type === 'rental' ? 'RENTAL_TAKEN' : 'GAME_FULL';
    if (m.includes('GAME_NOT_RESERVABLE') || m.includes('GAME_CANCELED')
        || m.includes('GAME_ALREADY_STARTED') || m.includes('ALTERNATIVE_TAKEN')) return 'GAME_UNAVAILABLE';
    return null;
  }

  async function handlePreCharge(method) {
    if (invitedMode) return { skip: true };
    const idempotencyKey = uuidv4();          // nueva key por intento (dedup en create_order)
    const claimComposition = buildClaimComposition();
    const { data, error } = await createOrder({
      idempotencyKey,
      resourceType:      game?.type,
      resourceId:        game?.id,
      claimComposition,
      amountTotal:       total,
      currency:          'PEN',
      financialSnapshot: buildMainSnapshot(method),       // ÚNICA fuente del snapshot
      pendingExpiresAt:  new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      paymentProvider:   null,
    });
    if (error || !data) {
      // create_order rechazó ANTES de cobrar → overlay visible + "sin cobro" garantizado.
      const token = reserveErrorToken(error?.message);
      if (token) { setNoChargeYet(true); setCapacityError(token); }
      else console.warn('[checkout] create_order failed:', error);
      return { error: error?.message ?? 'CREATE_ORDER_FAILED' };
    }
    return { orderId: data.id };
  }

  // ── Camino sin PaymentSheet — HOLD antes de debitar/materializar ───────────────
  // create_order → confirm_order (SIN pasarela) → MISMA materialización server-side.
  //   · provider='credit' (flujo principal 100% crédito): confirm_order valida saldo.
  //   · provider='invited' (invitación gratis del HOST): amount_total=0; confirm_order
  //     valida HOST y NO toca wallet (invited=true en el snapshot). No debita crédito.
  // Mismo claimComposition que usaría pasarela. NO_CAPACITY → capacityError.
  // Reutiliza handleExternalPaid para confirmar/navegar.
  async function payWithCredit(provider = 'credit') {
    const isInvited = provider === 'invited';
    const idempotencyKey = uuidv4();
    const claimComposition = buildClaimComposition();
    const { data, error } = await createOrder({
      idempotencyKey,
      resourceType:      game?.type,
      resourceId:        game?.id,
      claimComposition,
      amountTotal:       isInvited ? 0 : total,   // invited: 0; crédito: 0 si todo es crédito
      currency:          'PEN',
      financialSnapshot: buildMainSnapshot(provider),
      pendingExpiresAt:  new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      paymentProvider:   provider,
    });
    if (error || !data) {
      // create_order rechazó ANTES de debitar → overlay visible + "sin cobro" garantizado.
      const token = reserveErrorToken(error?.message);
      if (token) { setNoChargeYet(true); setCapacityError(token); }
      else console.warn('[checkout] create_order (credit) failed:', error);
      setFreeConfirming(false);
      return;   // NO se debitó crédito
    }
    await handleExternalPaid(provider, null, data.id);
  }

  // onPaid del PaymentSheet. Externo main (orderId) → confirm_order materializa
  // server-side (ÚNICA orquestación). addGuests (sin orderId) → camino cliente actual.
  async function handleExternalPaid(method, paymentProof, orderId) {
    if (!orderId) { handlePaid(method); return; }
    setFreeConfirming(true);

    // Éxito confirmado UNA sola vez (directo o vía polling): reutiliza la navegación de
    // éxito existente. Nunca navega dos veces ni tras unmount.
    const resolveConfirmed = () => {
      if (checkoutResolvedRef.current || !mountedRef.current) return;
      checkoutResolvedRef.current = true;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      try { localStorage.removeItem(`pending_game_referral:${game?.id}`); } catch {}
      finishConfirmedNavigation();
    };

    // Terminal NO confirmado (failed/expired, o capacidad agotada explícita): detiene el
    // loading y muestra el error con el MECANISMO EXISTENTE (overlay capacityError).
    const resolveTerminal = (token = null) => {
      if (checkoutResolvedRef.current || !mountedRef.current) return;
      checkoutResolvedRef.current = true;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      setFreeConfirming(false);
      setNoChargeYet(false);   // confirm_order es POST-cobro → NO afirmar "sin cobro"
      setCapacityError(token ?? (game?.type === 'rental' ? 'RENTAL_TAKEN' : 'GAME_FULL'));
    };

    // Poll del MISMO orderId hasta estado RESOLUTIVO. Un único timer (pollTimerRef).
    // pending → seguir; lectura incierta (red/auth/RLS: error o data null) → NO se asume
    // nada, la operación sigue INCIERTA y el overlay permanece → reintentar.
    const pollStatus = async () => {
      if (checkoutResolvedRef.current || !mountedRef.current) return;
      const { data: row, error: readErr } = await getOrderStatus({ orderId });
      if (checkoutResolvedRef.current || !mountedRef.current) return;
      const status = (!readErr && row) ? row.status : null;   // null = incierto → seguir
      if (status === 'confirmed') { resolveConfirmed(); return; }
      if (status === 'expired') { resolveTerminal('ORDER_EXPIRED'); return; }
      if (status === 'failed')  { resolveTerminal(); return; }
      pollTimerRef.current = setTimeout(pollStatus, 1000);     // pending / incierto
    };

    const { data, error } = await confirmOrder({ orderId, paymentProof });
    if (checkoutResolvedRef.current || !mountedRef.current) return;
    if (!error && data?.ok) { resolveConfirmed(); return; }

    // confirm_order devolvió error: NO cerramos el overlay ni volvemos a ConfirmReservation,
    // y NO asumimos que la Order esté failed. Terminal de capacidad EXPLÍCITO (la Order NO se
    // confirmará nunca) → mecanismo existente. Cualquier otro error (p. ej. AUTH_REQUIRED) →
    // la Order puede seguir PENDING: consultamos su estado real y mantenemos el overlay.
    let body = null;
    try { body = await error?.context?.json(); } catch {}
    const code = body?.error ?? null;
    // ORDER_EXPIRED: terminal explícito → overlay "Reserva expirada", SIN poll infinito.
    if (code === 'ORDER_EXPIRED') { resolveTerminal('ORDER_EXPIRED'); return; }
    if (code === 'GAME_FULL' || code === 'RENTAL_TAKEN' || code === 'INSUFFICIENT_CREDIT') { resolveTerminal(); return; }
    if (code === 'GAME_NOT_RESERVABLE' || code === 'GAME_CANCELED'
        || code === 'GAME_ALREADY_STARTED' || code === 'ALTERNATIVE_TAKEN') { resolveTerminal('GAME_UNAVAILABLE'); return; }
    console.warn('[checkout] confirm_order failed; polling order status:', code ?? error);
    pollStatus();
  }

  // onRejected del PaymentSheet. Externo main → fail_order libera el HOLD (Regla 2:
  // rechazo = sin materialización). addGuests (sin orderId) → comportamiento actual.
  async function handleRejected(orderId) {
    if (orderId) { await failOrder({ orderId, reason: 'payment_rejected' }); }
  }

  async function handlePaid(paymentMethod) {
    setFreeConfirming(true);
    setCapacityError(null);
    setPayOpen(false);
    if (!invitedMode && game?.hostUserId && authUser?.id && game.hostUserId === authUser.id) { setFreeConfirming(false); return; }
    if (invitedMode) {
      const gameId = game?.id;
      if (gameId && guests.length > 0) {
        const { data: resData, error } = await createInvitedReservation({ gameId, playersCount: guests.length, unitPrice });
        if (!error && resData) {
          const reservationId = resData.id;
          if (game?.type === 'match' || !game?.type) {
            const _slotRes = await loadSlotSnapshot(gameId, referral);
            await Promise.all(
              guests.map(guest => {
                const _assign = resolveCaptainGroupAssignment(_slotRes, { actorUserId: authUser?.id, enrolleeUserId: guest.id, linkOwnerUserId: null });
                return createGamePlayer({ gameId, userId: guest.id, payerId: authUser?.id, reservationId, amount: 0, reservationType: 'invited', invitedByUserId: authUser?.id, hostUserId: game?.hostUserId ?? null, gameSlotReservationId: _assign.gameSlotReservationId, countsReservedSlot: _assign.countsReservedSlot, referredByUserId: _assign.referredByUserId });
              })
            );
          }
          supabase?.from('notifications').insert({
            recipient_user_id: authUser?.id,
            source_type: 'venue', delivery_type: 'automatic', category: 'reservation',
            template_key: 'reservation_confirmed_with_guests',
            custom_text: 'Tu reserva incluye invitados. Recuérdales la hora y lugar.',
            game_id: gameId, venue_id: game?.venueId ?? null, reservation_id: reservationId,
            sent_at: new Date().toISOString(),
          }).then(({ error }) => {
            if (error) console.error('[notif] reservation_confirmed_with_guests (invited) failed:', error);
          });
          guests.filter(g => g.id).forEach(guest => {
            supabase?.from('notifications').insert({
              recipient_user_id: guest.id,
              source_type: 'venue', delivery_type: 'automatic', category: 'invitation',
              template_key: 'invited_by_player',
              custom_text: 'AlGrass te invitó a jugar. Revisa los detalles.',
              game_id: gameId, venue_id: game?.venueId ?? null, reservation_id: reservationId,
              created_by: authUser?.id,
              sent_at: new Date().toISOString(),
            }).then(({ error }) => {
              if (error) console.error('[notif] invited_by_player (invited) failed for', guest.id, error);
            });
          });
        }
      }
      setFreeConfirming(false);
      if (gameId) { try { const shown = JSON.parse(localStorage.getItem('pichanga_shown_confirmations')) || {}; delete shown[gameId]; localStorage.setItem('pichanga_shown_confirmations', JSON.stringify(shown)); } catch {} }
      try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
      navigate('/profile', { state: { confirmedGame: {
        id:       gameId,
        field:    game?.field,
        date:     game?.date,
        dateKey:  game?.dateKey  ?? null,
        time:     game?.time,
        ampm:     game?.ampm     ?? null,
        time24:   game?.time24   ?? null,
        source:   game?.source,
        gameType: game?.type     ?? null,
        amount:   null,
      }}});
      return;
    }
    if (addGuestsMode) {
      const gameId = game?.id;
      // "Gestionar mi lista": persistir N (ON → crea/reactiva R1 + adopta directos) o LIBERAR
      // (OFF → reserve_slots(0), solo si al entrar había R1 activa) ANTES de crear invitados: así
      // los nuevos NO quedan asociados a una R1 que se libera (el flujo posterior recarga snapshot).
      // _slotTotal = N REAL persistido (reserve_slots devuelve la R1 con reserved_slots_total, ya
      // con el clamp de piso aplicado); 0 al liberar. Se usa para la confirmación de cupos.
      let _slotTotal = armaLista ? reservedSlots : 0;
      if (armaListaMode && gameId && (game?.type === 'match' || !game?.type)) {
        if (armaLista) {
          const { data: _rsData, error: _rsErr } = await supabase.rpc('reserve_slots', { p_game_id: gameId, p_reserved_slots_total: reservedSlots, p_actor: authUser?.id });
          if (_rsErr) { setFreeConfirming(false); setCapacityError('GAME_FULL'); return; }
          const _rsRow = Array.isArray(_rsData) ? _rsData[0] : _rsData;
          if (_rsRow?.reserved_slots_total != null) _slotTotal = _rsRow.reserved_slots_total;
        } else if (_entryR1Active) {
          const { error: _rsErr } = await supabase.rpc('reserve_slots', { p_game_id: gameId, p_reserved_slots_total: 0, p_actor: authUser?.id });
          if (_rsErr) { setFreeConfirming(false); return; }
          _slotTotal = 0;
        }
        // La lista cambió → invalidar cache (patrón existente) para no pintar datos obsoletos
        // al reabrir; la próxima apertura refetchea (skeleton o cache fresco) y reconcilia.
        clearArmaCache(gameId, authUser?.id);
      }
      // Guardar sin invitados nuevos: no hay pago; volver a GameDetail (los datos se refrescan al remontar).
      // Se retira el marcador de reapertura para volver al detalle LIMPIO (sin reabrir "Gestionar mi
      // reserva"). El marcador solo debe reabrir al CANCELAR desde Add Guests, no tras un guardado exitoso.
      // gd_slot_confirm → GameDetail muestra UNA VEZ el ConfirmedOverlay de cupos existente.
      if (armaListaMode && guests.length === 0) {
        setFreeConfirming(false);
        try { sessionStorage.setItem('gd_slot_confirm', JSON.stringify({ gameId, total: _slotTotal, created: !_entryR1Active })); } catch { /* sessionStorage no disponible */ }
        try { sessionStorage.removeItem('gd_reopen_modify'); } catch { /* sessionStorage no disponible */ }
        try { sessionStorage.setItem('profile_dirty', '1'); } catch { /* sessionStorage no disponible */ }
        navigate(-1);
        return;
      }
      if (gameId && guests.length > 0) {
        const _adderCode = (() => { try { return (JSON.parse(localStorage.getItem('pichanga_profile') || '{}').userCode || '').trim().toUpperCase(); } catch { return ''; } })();
        addPlayersToRoster(gameId, guests, _adderCode);
        if (_adderCode) {
          try {
            const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
            const _prev = rosters[gameId]?.guestSubBreakdowns?.[_adderCode] || { unitPrice, guestsCount: 0, guestsTotal: 0 };
            rosters[gameId].guestSubBreakdowns = {
              ...(rosters[gameId].guestSubBreakdowns || {}),
              [_adderCode]: { unitPrice, guestsCount: _prev.guestsCount + guests.length, guestsTotal: _prev.guestsTotal + guestsTotal },
            };
            localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters));
          } catch {}
        }
        createReservation({
          gameId, unitPrice, promoCode: null, promoDiscount: 0,
          totalAmount: total, subtotalAmount: guestsTotal,
          playersCount: guests.length, guestTotal: guestsTotal,
          paymentMethod: paymentMethod || 'efectivo',
          creditApplied, source: game?.source ?? 'match',
        }).then(async ({ data: resData, error, skipped }) => {
          if (skipped || error) { setFreeConfirming(false); return; }
          const reservationId = resData?.id ?? null;
          if (game?.type === 'match' || !game?.type) {
            const _slotRes = await loadSlotSnapshot(gameId, referral);
            const _r1 = Array.isArray(_slotRes) ? _slotRes[0] : _slotRes;
            // BUMP-THEN-CREATE (regla definitiva): si el capitán tiene R1 activa y los invitados NO
            // caben en las N posiciones actuales, PRIMERO se amplía N con reserve_slots (atómico y
            // con su propia guarda de capacidad). Si used < N (hay hueco) NO se amplía: el invitado
            // ocupa el hueco con el flujo normal. NUNCA create → bump: si reserve_slots da GAME_FULL
            // no se crea ningún invitado. Entrada por link NO pasa por aquí, así que nunca sube N.
            if (_r1?.has_reservation && _r1?.status === 'active') {
              const _N = _r1.reserved_slots_total ?? 0;
              // PISO (no `used`): titular + invitados directos confirmed. `payer_id = actor`
              // captura al titular (paga a sí mismo) y a los invitados directos (los paga el
              // capitán); los que entraron por link pagan a sí mismos y NO cuentan. Los link
              // members ocupan hueco dentro de N sin exigir crecer N (solo se desplazan a
              // "fuera" en la UI). Por eso el bump se basa en newFloor = piso + nuevos.
              const { count: _floor } = await supabase.from('game_players')
                .select('id', { count: 'exact', head: true })
                .eq('game_id', gameId).eq('payer_id', authUser?.id).eq('status', 'confirmed');
              const _target = (_floor ?? 0) + guests.length; // newFloor
              if (_target > _N) {
                const { error: _rsErr } = await supabase.rpc('reserve_slots', { p_game_id: gameId, p_reserved_slots_total: _target, p_actor: authUser?.id });
                if (_rsErr) { setFreeConfirming(false); setCapacityError('GAME_FULL'); return; } // sin invitados creados
              }
            }
            const gpResults = await Promise.all(guests.map(guest => {
              const _assign = resolveCaptainGroupAssignment(_slotRes, { actorUserId: authUser?.id, enrolleeUserId: guest.id, linkOwnerUserId: null });
              return createGamePlayer({ gameId, userId: guest.id, reservationId, amount: unitPrice, hostUserId: game?.hostUserId ?? null, gameSlotReservationId: _assign.gameSlotReservationId, countsReservedSlot: _assign.countsReservedSlot, referredByUserId: _assign.referredByUserId });
            }));
            if (gpResults.some(r => r?.error?.message?.startsWith('GAME_FULL'))) { setFreeConfirming(false); setCapacityError('GAME_FULL'); return; }
          }
          supabase?.from('notifications').insert({
            recipient_user_id: authUser?.id,
            source_type: 'venue', delivery_type: 'automatic', category: 'reservation',
            template_key: 'reservation_confirmed_with_guests',
            custom_text: `Añadiste a ${guestNamesText(guests)} a tu reserva. Recuérdales la hora y lugar.`,
            game_id: gameId, venue_id: game?.venueId ?? null, reservation_id: reservationId,
            sent_at: new Date().toISOString(),
          }).then(({ error }) => {
            if (error) console.error('[notif] reservation_confirmed_with_guests (addGuests) failed:', error);
          });
          guests.filter(g => g.id).forEach(guest => {
            supabase?.from('notifications').insert({
              recipient_user_id: guest.id,
              source_type: 'venue', delivery_type: 'automatic', category: 'invitation',
              template_key: 'invited_by_player',
              custom_text: `${firstName(authUser?.name)} te invitó a jugar. Revisa los detalles.`,
              game_id: gameId, venue_id: game?.venueId ?? null, reservation_id: reservationId,
              created_by: authUser?.id,
              sent_at: new Date().toISOString(),
            }).then(({ error }) => {
              if (error) console.error('[notif] invited_by_player (addGuests) failed for', guest.id, error);
            });
          });
          try {
            const shown = JSON.parse(localStorage.getItem('pichanga_shown_confirmations')) || {};
            delete shown[gameId];
            localStorage.setItem('pichanga_shown_confirmations', JSON.stringify(shown));
          } catch {}
          try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
          navigate('/profile', { state: { confirmedGame: {
            id:       gameId,
            field:    game?.field,
            date:     game?.date,
            dateKey:  game?.dateKey  ?? null,
            time:     game?.time,
            ampm:     game?.ampm     ?? null,
            time24:   game?.time24   ?? null,
            source:   game?.source,
            gameType: game?.type     ?? null,
            amount:   total,
          }}});
        });
      } else {
        setFreeConfirming(false);
      }
      return;
    }
    if (!isRental && guests.length > 0) {
      const _gid = game?.id;
      if (_gid) {
        const _payerProfile = (() => { try { return JSON.parse(localStorage.getItem('pichanga_profile') || '{}'); } catch { return {}; } })();
        createRoster(_gid, guests, {
          reservedAt: reservationTs.current,
          payerName: canonicalName || _payerProfile.fullName || 'Usuario',
          payerCode: _payerProfile.userCode  || '',
        });
      }
    }
    // Camino interno (100% crédito/gratis): materializa con el ctx del navegador. La MISMA
    // orquestación (materializeReservation) la usa confirm_order con ctx service-role.
    const _snapshot = buildMainSnapshot(paymentMethod);
    const _res = await materializeReservation({ db: supabase, actor: authUser?.id }, _snapshot);
    // Ciclo de vida del referral (idéntico al original): consumido en cuanto el titular
    // se inscribe, aunque reserve_slots falle después. Solo esta clave, solo si se creó.
    if (_res.referralConsumed) { try { localStorage.removeItem(`pending_game_referral:${game?.id}`); } catch {} }
    if (_res.code === 'RENTAL_TAKEN') { setFreeConfirming(false); setCapacityError('RENTAL_TAKEN'); return; }
    if (_res.code === 'GAME_FULL')    { setFreeConfirming(false); setCapacityError('GAME_FULL'); return; }
    if (_res.error || _res.skipped)   { if (_res.error) console.warn('[checkout] reservation failed:', _res.error); setFreeConfirming(false); return; }
    finishConfirmedNavigation();
  }

  if (subView === 'addplayers') {
    return (
      <div className="screen-shell cr-shell-fill" style={{ overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <AddPlayersScreen
          alreadySelected={guests}
          onCancel={() => setSubView('confirm')}
          onConfirm={selected => {
            // "Gestionar mi lista": al agregar invitados, crecer N lo justo para NO desplazar a los
            // links que YA estaban en la Lista (se preserva su cantidad). Los links que estaban FUERA
            // siguen fuera (solo suben con la flecha ↑ o subiendo N a mano). reserve_slots valida al guardar.
            if (armaListaMode && armaLista) {
              const floorOld = 1 + directosLista.length + guests.length;
              const linksInListaOld = Math.min(Math.max(reservedSlots - floorOld, 0), linkMembers.length);
              const floorNew = 1 + directosLista.length + selected.length;
              setReservedSlots(Math.max(reservedSlots, floorNew + linksInListaOld));
            }
            setGuests(selected); setSubView('confirm');
          }}
          paidPlayers={paidPlayers}
          maxGuests={guestSlots ?? 99}
          spotsCount={(addGuestsMode || invitedMode) ? (maxNewGuests < 99 ? maxNewGuests : undefined) : rawSpots}
          isInscribed={addGuestsMode || invitedMode}
          gameId={game?.id}
          rosterPlayerIds={rosterPlayerIds}
          hostUserId={game?.hostUserId ?? null}
        />
      </div>
    );
  }

  return (
    <div className="screen-shell cr-shell-fill" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <TopBar
        title={invitedMode ? 'Agregar jugadores' : armaListaMode ? 'Gestionar mi lista' : addGuestsMode ? 'Agregar invitados' : isRental ? 'Reservar cancha' : 'Confirmación de reserva'}
        rightNode={armaListaMode ? (
          <button onClick={shareGameLink} aria-label="Compartir" style={{ width: 34, height: 34, borderRadius: '50%', background: SOFT, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v11M12 3L8 7M12 3l4 4" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 11v8a1 1 0 001 1h10a1 1 0 001-1v-8" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : undefined}
        onCancel={() => {
          if (addGuestsMode || invitedMode) { navigate(-1); return; }
          const dest = game?.backPath ?? (isRental || game?.source === 'campo' ? '/fields' : '/games');
          if (game?.gameDetailBackPath && dest.startsWith('/game/')) {
            navigate(dest, { state: { backPath: game.gameDetailBackPath } });
          } else if (dest.startsWith('/field/') || dest.startsWith('/rental/')) {
            navigate(-1);
          } else {
            navigate(dest);
          }
        }}
      />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'none' }}>
        {game && (
          <>
            <div style={{ padding: '14px 16px 0' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: TEXT, letterSpacing: -0.6, lineHeight: 1.1 }}>{game.field}</div>
            </div>
            <div style={{ padding: '14px 16px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="4" width="16" height="13.5" rx="1.8" stroke={TEXT} strokeWidth="1.5"/>
                  <path d="M2 8h16" stroke={TEXT} strokeWidth="1.5"/>
                  <path d="M6 2v3M14 2v3" stroke={TEXT} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ flex: 1, paddingTop: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{game.date}</div>
                <div style={{ marginTop: 2, fontSize: 13.5, color: SUB, lineHeight: 1.4 }}>{[game.time, game.ampm].filter(Boolean).join(' ')} · {game.duration}</div>
              </div>
            </div>
          </>
        )}

        {(isCaptain || isCaptainGold) && !isCampo && !isRental && ((!addGuestsMode && !invitedMode) || armaListaMode) && (
          <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 8.8-4.1-1.2-7-4.6-7-8.8V6l7-3z" fill={slotReservationClosed ? '#C7C7CC' : captainColor} stroke={slotReservationClosed ? '#C7C7CC' : captainColor} strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: slotReservationClosed ? '#9A9AA0' : TEXT, letterSpacing: -0.2 }}>Arma la lista</div>
              <div style={{ fontSize: 12.5, color: slotReservationClosed ? '#C7C7CC' : SUB, marginTop: 1 }}>Hasta {releaseHours}h antes del partido</div>
            </div>
            <button onClick={toggleArmaLista} role="switch" aria-checked={armaLista} disabled={armaListToggleDisabled}
              style={{ width: 44, height: 26, borderRadius: 999, border: 'none', background: armaLista ? BLUE : '#E5E5EA', cursor: armaListToggleDisabled ? 'default' : 'pointer', padding: 0, position: 'relative', transition: 'background .2s ease', WebkitTapHighlightColor: 'transparent', outline: 'none', flexShrink: 0, opacity: armaListToggleDisabled ? 0.5 : 1 }}>
              <div style={{ position: 'absolute', top: 2, left: armaLista ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </button>
          </div>
        )}

        {!armaLista && !isCampo && !isRental && !addGuestsMode && !invitedMode && (
          <div style={{ padding: '24px 16px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, letterSpacing: -0.1 }}>
              Reservando {seats} {seats === 1 ? 'lugar' : 'lugares'} para
            </div>
          </div>
        )}

        {!armaLista && !isCampo && !isRental && !addGuestsMode && !invitedMode && (
          <div style={{ padding: '12px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <Avatar name={canonicalName} hue={selfAvatar.hue ?? 210} size={44} avatarPath={selfAvatar.path} avatarVersion={selfAvatar.version} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canonicalName} <span style={{ color: SUB, fontWeight: 600 }}>(Tú)</span></div>
                <div style={{ fontSize: 12.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{unitStr}</div>
            </div>
          </div>
        )}

        {armaLista && (isCaptain || isCaptainGold) && !isCampo && !isRental && !addGuestsMode && !invitedMode && (
          <div style={{ padding: '0 16px' }}>
            {/* Contador N (total de la lista). Piso = titular + invitados. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '6px 0' }}>
              {stepBtn(() => setReservedSlots(n => Math.max(listFloorMin, n - 1)), reservedSlots <= listFloorMin || slotReservationClosed || onlyTitularSpot, false)}
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 22, fontWeight: 800, color: TEXT }}>{reservedSlots}</span>
              {stepBtn(() => setReservedSlots(n => n + 1), slotReservationClosed || onlyTitularSpot || _refPending || (reservedMax != null && (reservedSlots - listFloor) >= reservedMax), true)}
            </div>
            {/* Disponibilidad — reutiliza reservedMax (misma capacidad existente). Una sola línea. */}
            <div style={{ fontSize: 12.5, color: SUB, textAlign: 'center', paddingBottom: 8 }}>
              Estás reservando {reservedSlots} {reservedSlots === 1 ? 'cupo exclusivo' : 'cupos exclusivos'} para ti y tus amigos{reservedMax != null ? ` · solo quedan ${Math.max(0, reservedMax - emptySlots)} disponibles` : ''}
            </div>
            <div style={{ height: 1, background: HAIR }} />
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '12px 0 2px' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>Lista</span>
              <span style={{ fontSize: 12.5, color: SUB, whiteSpace: 'nowrap' }}>{listFloor} {listFloor === 1 ? 'jugador pre-inscrito' : 'jugadores pre-inscritos'}</span>
            </div>
            {/* 1 · titular (mismo diseño de fila) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
              <div style={{ width: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: SUB, flexShrink: 0 }}>1</div>
              <Avatar name={canonicalName} hue={selfAvatar.hue ?? 210} size={44} avatarPath={selfAvatar.path} avatarVersion={selfAvatar.version} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canonicalName} <span style={{ color: SUB, fontWeight: 600 }}>(Tú)</span></div>
                <div style={{ fontSize: 12.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{unitStr}</div>
            </div>
            {/* invitados (mismo diseño de fila) */}
            {guests.map((g, i) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                <div style={{ width: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: SUB, flexShrink: 0 }}>{i + 2}</div>
                <Avatar name={g.name} hue={g.hue} size={44} avatarPath={g.avatarPath ?? null} avatarVersion={g.avatarVersion ?? null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  {g.code && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{g.code}</div>}
                </div>
                <button onClick={() => setGuests(gs => gs.filter(x => x.id !== g.id))} style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" fill="#FCEAEB"/><path d="M7 7l6 6M13 7l-6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
                <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{fmt(unitPrice)}</div>
              </div>
            ))}
            {/* cupos reservados vacíos hasta N */}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <button key={`empty-${i}`} onClick={copyGameLink} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <div style={{ width: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: SUB, flexShrink: 0 }}>{listFloor + i + 1}</div>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#C7C7CC" strokeWidth="1.5" strokeDasharray="3 3"/><path d="M12 8.5v7M8.5 12h7" stroke="#C7C7CC" strokeWidth="1.6" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: SUB }}>cupo reservado</div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>comparte tu link</div>
                </div>
              </button>
            ))}
            {/* Agregar jugadores (mismo flujo/estilo, ubicado bajo la Lista) */}
            <div style={{ padding: '14px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {(() => {
                const noSlots = displaySpots === 0;
                const btnColor = noSlots ? '#C4C4CC' : ORANGE;
                return (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={noSlots ? undefined : () => setSubView('addplayers')} style={{ padding: '10px 4px 10px 14px', background: 'transparent', border: 'none', cursor: noSlots ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: btnColor, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none', opacity: noSlots ? 0.5 : 1 }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke={btnColor} strokeWidth="1.6"/><path d="M10 6v8M6 10h8" stroke={btnColor} strokeWidth="1.7" strokeLinecap="round"/></svg>
                      Agregar jugadores
                    </button>
                    <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>Pagas tú</span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Lista dinámica (roster): skeleton mientras carga; el contenido fijo de arriba
            (venue, fecha, "Arma la lista") ya está renderizado real. */}
        {armaListaMode && !listLoaded ? <ArmaListSkeleton /> : armaLista && armaListaMode && (
          <div style={{ padding: '0 16px' }}>
            {/* Contador N. Piso = titular + directos existentes de mi lista + nuevos de esta edición. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '6px 0' }}>
              {stepBtn(() => setReservedSlots(n => Math.max(listFloorMin, n - 1)), reservedSlots <= listFloorMin || slotReservationClosed, false)}
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 22, fontWeight: 800, color: TEXT }}>{reservedSlots}</span>
              {stepBtn(() => setReservedSlots(n => n + 1), slotReservationClosed || (reservedMax != null && (reservedSlots - listFloor) >= reservedMax), true)}
            </div>
            {(() => {
              // Secuencia priorizada: titular → directos existentes → nuevos → link. Los primeros N = Lista.
              const seq = [
                { t: 'titular' },
                ...directosLista.map(p => ({ t: 'direct', p })),
                ...guests.map(g => ({ t: 'new', g })),
                ...linkMembers.map(p => ({ t: 'link', p })),
              ];
              const N = reservedSlots;
              const inLista = seq.slice(0, N);
              const fuera   = seq.slice(N);                 // solo UX; NO cambia gsr/counts
              const empties = Math.max(0, N - seq.length);
              const publicLeft = reservedMax != null ? Math.max(0, reservedMax - empties) : null;
              const av = (p) => <Avatar name={p.full_name || 'Jugador'} hue={p.avatar_hue ?? 210} size={44} avatarPath={p.avatar_path ?? null} avatarVersion={p._av ?? null} />;
              const NUM = (n) => <div style={{ width: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: SUB, flexShrink: 0 }}>{n}</div>;
              const tag = (txt) => <span style={{ fontSize: 12, fontWeight: 700, color: SUB, flexShrink: 0 }}>{txt}</span>;
              // Flecha ↑: sube un link (ya reservado / counts=true) a la Lista aumentando N en 1.
              // No consume capacidad nueva (el jugador ya ocupa su cupo); reserve_slots la persiste al guardar.
              const upArrow = (p) => (
                <button onClick={() => { setPromotedLinkIds(ids => ids.includes(p.id) ? ids : [...ids, p.id]); setReservedSlots(n => n + 1); }}
                  aria-label="Subir a la lista"
                  style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: SOFT, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 14l5-5 5 5" stroke={SUB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              );
              const row = (item, key, num, rightOverride) => {
                const wrap = (avatar, name, sub, right) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                    {num != null && NUM(num)}
                    {avatar}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      {sub && <div style={{ fontSize: 12, color: SUB, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                    </div>
                    {right}
                  </div>
                );
                if (item.t === 'titular') return wrap(
                  <Avatar name={canonicalName} hue={selfAvatar.hue ?? 210} size={44} avatarPath={selfAvatar.path} avatarVersion={selfAvatar.version} />,
                  <>{canonicalName} <span style={{ color: SUB, fontWeight: 600 }}>(Tú)</span></>, user.email, rightOverride ?? tag('Tú'));
                if (item.t === 'direct') return wrap(av(item.p), item.p.full_name || 'Invitado', item.p.user_code ? `@${item.p.user_code}` : null, rightOverride ?? tag('Tu invitado'));
                if (item.t === 'link')   return wrap(av(item.p), item.p.full_name || 'Jugador', item.p.user_code ? `@${item.p.user_code}` : null, rightOverride ?? tag('Con tu link'));
                // nuevo invitado de esta edición: precio + X (flujo actual)
                const g = item.g;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                    {num != null && NUM(num)}
                    <Avatar name={g.name} hue={g.hue} size={44} avatarPath={g.avatarPath ?? null} avatarVersion={g.avatarVersion ?? null} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                      {g.code && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{g.code}</div>}
                    </div>
                    <button onClick={() => setGuests(gs => gs.filter(x => x.id !== g.id))} style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" fill="#FCEAEB"/><path d="M7 7l6 6M13 7l-6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/></svg>
                    </button>
                    <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{fmt(unitPrice)}</div>
                  </div>
                );
              };
              return (
                <>
                  <div style={{ fontSize: 12.5, color: SUB, textAlign: 'center', paddingBottom: 8 }}>
                    Estás reservando {reservedSlots} {reservedSlots === 1 ? 'cupo exclusivo' : 'cupos exclusivos'} para ti y tus amigos{publicLeft != null ? ` · solo quedan ${publicLeft} disponibles` : ''}
                  </div>
                  <div style={{ height: 1, background: HAIR }} />
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '12px 0 2px' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>Lista</span>
                    <span style={{ fontSize: 12.5, color: SUB, whiteSpace: 'nowrap' }}>{inLista.length}/{N}</span>
                  </div>
                  {inLista.map((it, i) => row(it, `l-${i}`, i + 1))}
                  {Array.from({ length: empties }).map((_, i) => (
                    <button key={`empty-${i}`} onClick={copyGameLink} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      {NUM(inLista.length + i + 1)}
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#C7C7CC" strokeWidth="1.5" strokeDasharray="3 3"/><path d="M12 8.5v7M8.5 12h7" stroke="#C7C7CC" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: SUB }}>cupo reservado</div>
                        <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>comparte tu link</div>
                      </div>
                    </button>
                  ))}
                  {/* Agregar jugadores — bajo la Lista, antes de "Amigos fuera de lista" */}
                  <div style={{ padding: '14px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    {(() => {
                      const noSlots = displaySpots === 0;
                      const btnColor = noSlots ? '#C4C4CC' : ORANGE;
                      return (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={noSlots ? undefined : () => setSubView('addplayers')} style={{ padding: '10px 4px 10px 14px', background: 'transparent', border: 'none', cursor: noSlots ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: btnColor, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none', opacity: noSlots ? 0.5 : 1 }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke={btnColor} strokeWidth="1.6"/><path d="M10 6v8M6 10h8" stroke={btnColor} strokeWidth="1.7" strokeLinecap="round"/></svg>
                            Agregar jugadores
                          </button>
                          <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>Pagas tú</span>
                        </div>
                      );
                    })()}
                  </div>
                  {fuera.length > 0 && (
                    <>
                      <div style={{ padding: '8px 0 2px', paddingLeft: 30 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: SUB, letterSpacing: -0.1 }}>Amigos sin cupos asegurados</div>
                        <div style={{ fontSize: 11.5, color: '#9A9AA0', marginTop: 1 }}>Ingresaron también con tu link, pero si alguno cancela el cupo se libera al público</div>
                      </div>
                      {fuera.map((it, i) => row(it, `f-${i}`, '–', it.t === 'link' ? upArrow(it.p) : undefined))}
                    </>
                  )}
                  {otrosInscritos.length > 0 && (
                    <>
                      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2, padding: '12px 0 2px', borderTop: `1px solid ${HAIR}`, marginTop: 2 }}>Otros jugadores inscritos</div>
                      {otrosInscritos.map((p, i) => {
                        const miInvitadoOtroGrupo = p.payer_id === _capId && p.game_slot_reservation_id != null && p.game_slot_reservation_id !== _myR1Id;
                        const otroGrupo = p.game_slot_reservation_id != null && p.game_slot_reservation_id !== _myR1Id && p.counts_reserved_slot === true;
                        return (
                          <div key={`o-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', opacity: otroGrupo ? 0.6 : 1 }}>
                            {av(p)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name || 'Jugador'}</div>
                              {p.user_code && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>@{p.user_code}</div>}
                            </div>
                            {(miInvitadoOtroGrupo || otroGrupo) && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'right', flexShrink: 0, lineHeight: 1.35 }}>
                                {miInvitadoOtroGrupo && <>Tu invitado<br/></>}Otro grupo
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {!armaLista && !isCampo && !isRental && guests.length > 0 && (
          <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {guests.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <Avatar name={g.name} hue={g.hue} size={44} avatarPath={g.avatarPath ?? null} avatarVersion={g.avatarVersion ?? null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  {g.code && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{g.code}</div>}
                </div>
                <button onClick={() => setGuests(gs => gs.filter(x => x.id !== g.id))} style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="9" fill="#FCEAEB"/>
                    <path d="M7 7l6 6M13 7l-6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </button>
                <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{fmt(unitPrice)}</div>
              </div>
            ))}
          </div>
        )}

        {!armaLista && !isCampo && !isRental && (
          <div style={{ padding: '18px 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {(() => {
              const noSlots = displaySpots === 0;
              const btnColor = noSlots ? '#C4C4CC' : ORANGE;
              return (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={noSlots ? undefined : () => setSubView('addplayers')}
                    style={{ padding: '10px 4px 10px 14px', background: 'transparent', border: 'none', cursor: noSlots ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: btnColor, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none', opacity: noSlots ? 0.5 : 1 }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" stroke={btnColor} strokeWidth="1.6"/>
                      <path d="M10 6v8M6 10h8" stroke={btnColor} strokeWidth="1.7" strokeLinecap="round"/>
                    </svg>
                    Agregar jugadores
                  </button>
                  <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>Pagas tú</span>
                </div>
              );
            })()}
            {spotsLabel && (
              <div style={{ fontSize: 12.5, color: displaySpots === 0 ? DANGER : SUB }}>
                {spotsLabel}
              </div>
            )}
          </div>
        )}
        <div style={{ height: 8 }} />
      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px max(12px, env(safe-area-inset-bottom))' }}>
        {!promoOpen && !promoApplied && !addGuestsMode && !invitedMode && (
          <button onClick={() => setPromoOpen(true)} style={{ padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: ORANGE, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 6, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 7.5V2.5h5l7 7-5 5-7-7z" stroke={ORANGE} strokeWidth="1.4" strokeLinejoin="round"/>
              <circle cx="5.4" cy="5.4" r="0.9" fill={ORANGE}/>
            </svg>
            Código promocional
          </button>
        )}

        {promoOpen && !promoApplied && !addGuestsMode && !invitedMode && (
          <div style={{ padding: '4px 0 10px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${promoError ? DANGER : HAIR}`, background: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 7.5V2.5h5l7 7-5 5-7-7z" stroke={ORANGE} strokeWidth="1.4" strokeLinejoin="round"/>
                  <circle cx="5.4" cy="5.4" r="0.9" fill={ORANGE}/>
                </svg>
                <input
                  value={promoInput}
                  onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') applyCode(); }}
                  placeholder="Ingresa tu código"
                  style={{ flex: 1, minWidth: 0, height: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 14, color: TEXT, letterSpacing: 0.5, textTransform: 'uppercase' }}
                />
                <button onClick={() => { setPromoOpen(false); setPromoInput(''); setPromoError(''); }} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: SUB, display: 'inline-flex', alignItems: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3l-8 8" stroke={SUB} strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <button onClick={applyCode} disabled={!promoInput.trim() || promoLoading} style={{ height: 42, padding: '0 16px', borderRadius: 10, background: (promoInput.trim() && !promoLoading) ? TEXT : '#E8E8EC', color: (promoInput.trim() && !promoLoading) ? '#fff' : '#9A9AA0', border: 'none', cursor: (promoInput.trim() && !promoLoading) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, flexShrink: 0, WebkitTapHighlightColor: 'transparent', outline: 'none', minWidth: 72, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {promoLoading
                  ? <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(27,27,31,0.2)', borderTop: '2px solid #9A9AA0', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  : 'Aplicar'}
              </button>
            </div>
            {promoError && <div style={{ marginTop: 6, fontSize: 12.5, color: DANGER, paddingLeft: 2 }}>{promoError}</div>}
          </div>
        )}

        {promoApplied && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, background: '#E8F7EE', border: '1px solid #BFE6CC', borderRadius: 10 }}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" fill="#2BA15A"/>
              <path d="M5 9.2l2.6 2.6L13 6.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div style={{ flex: 1, fontSize: 13, color: '#1F6B36', fontWeight: 600 }}>Código aplicado correctamente</div>
            <button onClick={() => { setPromoApplied(null); setPromoInput(''); setPromoError(''); }} style={{ padding: '2px 6px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#1F6B36', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Quitar</button>
          </div>
        )}

        <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {invitedMode && guests.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
                <span>Precio{guests.length > 1 ? ` × ${guests.length}` : ''}</span>
                <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(guestsTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
                <span>Descuento Invitado</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{fmt(guestsTotal)}</span>
              </div>
            </>
          )}
          {!invitedMode && !addGuestsMode && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>{isRental ? 'Campo' : 'Titular'}</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{unitStr}</span>
            </div>
          )}
          {!invitedMode && !addGuestsMode && reservedSlots > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>Reserva de cupos ({reservedSlots})</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(0)}</span>
            </div>
          )}
          {!invitedMode && !addGuestsMode && promoApplied && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
              <span>Descuento{promoApplied.kind === 'percent' ? ` · ${promoApplied.value}%` : ''}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{fmt(promoApplied.discount)}</span>
            </div>
          )}
          {!invitedMode && guests.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>Invitados ({guests.length})</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(guestsTotal)}</span>
            </div>
          )}
          {!invitedMode && creditApplied > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
                <span>Crédito aplicado</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{fmt(creditApplied)}</span>
              </div>
              <div style={{ fontSize: 11, color: SUB }}>Saldo disponible: {fmt(creditBalance)}</div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: (invitedMode ? guests.length > 0 : true) ? 8 : 0, borderTop: (invitedMode ? guests.length > 0 : true) ? `1px solid ${HAIR}` : 'none', marginTop: (invitedMode ? guests.length > 0 : true) ? 4 : 0, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>
            <span>Total</span>
            <span style={{ whiteSpace: 'nowrap' }}>{totalStr}</span>
          </div>
        </div>

        <CtaButton onPress={handleConfirm} disabled={((addGuestsMode || invitedMode) && guests.length === 0 && !_listDirty) || creditLoading || freeConfirming}>
          {creditLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
              Procesando...
            </span>
          ) : (armaListaMode && guests.length === 0 ? 'Guardar cambios' : 'Confirmar')}
        </CtaButton>
      </div>

      {payOpen && (
        <PaymentSheet
          amount={total}
          currency={currency}
          label={totalStr}
          onClose={() => setPayOpen(false)}
          onPreCharge={handlePreCharge}
          onPaid={handleExternalPaid}
          onRejected={handleRejected}
        />
      )}

      {freeConfirming && (
        <div className="sheet-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10,10,15,0.88)',
          padding: '0 32px',
        }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.2)', borderTop: '4px solid #fff', animation: 'spin 0.9s linear infinite', marginBottom: 28 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3 }}>
            Estamos confirmando tu reserva...
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            No cierres esta pantalla.
          </div>
        </div>
      )}

      {linkCopied && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          ¡Link copiado!
        </div>
      )}

      {capacityError && (() => {
        const isExpired = capacityError === 'ORDER_EXPIRED';
        const isUnavail = capacityError === 'GAME_UNAVAILABLE';
        const isRentalType = game?.type === 'rental';
        const u = gameUnavailableCopy(isRentalType);   // copy ÚNICO compartido con GameDetail
        // capacidad = GAME_FULL / RENTAL_TAKEN / RESERVED_SLOTS_UNAVAILABLE (falta de cupos)
        const capTitle = isExpired ? 'Reserva expirada'
          : isUnavail ? u.title
          : 'No hay suficientes cupos disponibles';
        const capBody = isExpired
          ? 'El tiempo para completar la reserva terminó. Vuelve a intentarlo.'
          : isUnavail
            ? u.message
            : 'Mientras realizabas la reserva, uno o más cupos fueron reservados. Vuelve para consultar la disponibilidad actual.';
        // GAME_UNAVAILABLE → LISTA (u.path). Capacidad y ORDER_EXPIRED → detalle (navigate(-1)).
        const capCta = isUnavail ? u.cta : (isRentalType ? 'Volver a la cancha' : 'Volver al partido');
        const onCta = isUnavail ? () => navigate(u.path) : () => navigate(-1);
        return (
          <div className="sheet-overlay" style={{
            position: 'fixed', inset: 0, zIndex: 200,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: '#fff', padding: '0 32px',
          }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FCEAEB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke={DANGER} strokeWidth="1.8"/>
                <path d="M15 9l-6 6M9 9l6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.4, textAlign: 'center' }}>
              {capTitle}
            </div>
            <div style={{ marginTop: 8, fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.5, maxWidth: 300 }}>
              {capBody}
            </div>
            {noChargeYet && (
              <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: DANGER, textAlign: 'center', letterSpacing: 0.2 }}>
                NO SE REALIZÓ NINGÚN COBRO
              </div>
            )}
            <div style={{ marginTop: 28, width: '100%', maxWidth: 320 }}>
              <CtaButton onPress={onCta}>
                {capCta}
              </CtaButton>
            </div>
          </div>
        );
      })()}

      {showConfirmed && (
        <ConfirmedOverlay
          game={{ field: game?.field, date: game?.date, amount: addGuestsMode ? total : null }}
          shareLink={buildGameShareUrl(game?.id, { sharedByUserId: authUser?.id })}
          reservedSlots={reservedSlots}
          releaseHours={releaseHours}
          onOK={() => { setShowConfirmed(false); navigate(-1); }}
        />
      )}
    </div>
  );
}
