import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE, SOFT, DANGER, YAPE } from '../constants';
import I from '../icons';
import { shareOrCopy } from '../utils/share';
import { addPlayers as addPlayersToRoster, createRoster, getActivePlayers } from '../services/gameService';
import { getReservations, setReservations, getCredit, setCredit, getPaidStatus, setPaidStatus, createReservation } from '../services/reservationService';

// ── Player database & history ──────────────────────────────────────────────

const ALL_PLAYERS = [
  { id: 'p1',  name: 'Pedro Silva',      hue: 12,  code: '@pedrosilva'   },
  { id: 'p2',  name: 'María Quispe',     hue: 280, code: '@mariaquispe'  },
  { id: 'p3',  name: 'Diego Morales',    hue: 200, code: '@diegomorales' },
  { id: 'p4',  name: 'Luis Ramos',       hue: 140, code: '@luisramos'    },
  { id: 'p5',  name: 'Camila Rojas',     hue: 330, code: '@camilarojas'  },
  { id: 'p6',  name: 'Jorge Bustamante', hue: 40,  code: '@jorgebusta'   },
  { id: 'p7',  name: 'Andrea Núñez',     hue: 175, code: '@andreanunez'  },
  { id: 'p8',  name: 'Renato Díaz',      hue: 260, code: '@renatodiaz'   },
  { id: 'p9',  name: 'Sofía Mendoza',    hue: 350, code: '@sofiamendoza' },
  { id: 'p10', name: 'Carlos Vera',      hue: 22,  code: '@carlosvera'   },
  { id: 'p11', name: 'Gabriela Ortiz',   hue: 305, code: '@gabortiz'     },
  { id: 'p12', name: 'Sebastián Lara',   hue: 190, code: '@sebalara'     },
  { id: 'p13', name: 'Valeria Castro',   hue: 355, code: '@valeriacastro'},
  { id: 'p14', name: 'Andrés Flores',    hue: 155, code: '@andresflores' },
  { id: 'p15', name: 'Natalia Paredes',  hue: 240, code: '@nataliapar'   },
];

const ROSTER_KEY = 'pichanga_game_rosters';


function getFavorites(paidPlayers) {
  const seen = new Set();
  const result = [];
  for (const e of paidPlayers) {
    if (!seen.has(e.id)) { seen.add(e.id); result.push(e); }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ── Promo ──────────────────────────────────────────────────────────────────

const PROMO_CODES = {
  PERSONAL2026: { kind: 'percent', value: 20 },
};

function applyPromo(unitPrice, code) {
  const def = PROMO_CODES[code?.trim().toUpperCase()];
  if (!def) return { discount: 0, def: null };
  const discount = def.kind === 'percent'
    ? Math.min(unitPrice * (def.value / 100), unitPrice)
    : Math.min(def.value, unitPrice);
  return { discount, def: { ...def, code: code.trim().toUpperCase() } };
}

// ── Shared primitives ──

function Avatar({ name, hue = 210, size = 44 }) {
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
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

function PlayerRow({ p, checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <Avatar name={p.name} hue={p.hue} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{p.code}</div>
      </div>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        border: `1.6px solid ${checked ? ORANGE : '#C7C7CC'}`,
        background: checked ? ORANGE : '#fff',
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

function AddPlayersScreen({ alreadySelected, onCancel, onConfirm, paidPlayers, maxGuests = 99, spotsCount, isInscribed = false, gameId, rosterPlayerIds = new Set() }) {
  const favorites  = getFavorites(paidPlayers);
  const hasAnyData = paidPlayers.length > 0;

  const initIds = new Set(alreadySelected.map(g => g.id));
  const [query, setQuery]             = useState('');
  const [selectedIds, setSelectedIds] = useState(() => initIds);
  const [linkCopied, setLinkCopied]   = useState(false);
  const [dupMsg, setDupMsg]           = useState('');

  const q = query.trim().toLowerCase();
  const sortByName = (a, b) => a.name.localeCompare(b.name, 'es');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedRef = useMemo(
    () => ALL_PLAYERS.filter(p => selectedIds.has(p.id)).sort(sortByName).map(p => p.id),
    [q]
  );
  const sortedRefSet = new Set(sortedRef);

  function toggle(id) {
    if (rosterPlayerIds.has(id)) {
      setDupMsg('Este jugador ya está inscrito');
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

  const topList = q
    ? [
        ...sortedRef.filter(id => selectedIds.has(id)).map(id => ALL_PLAYERS.find(p => p.id === id)).filter(Boolean),
        ...ALL_PLAYERS.filter(p => selectedIds.has(p.id) && !sortedRefSet.has(p.id)),
      ]
    : ALL_PLAYERS.filter(p => selectedIds.has(p.id)).sort(sortByName);

  const listBelow = q
    ? ALL_PLAYERS.filter(p => !selectedIds.has(p.id) && (p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)))
    : favorites.filter(p => !selectedIds.has(p.id));

  const noMatchAtAll = q && !ALL_PLAYERS.some(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));

  const selectedPlayers = ALL_PLAYERS.filter(p => selectedIds.has(p.id));

  const prevIds      = new Set(alreadySelected.map(g => g.id));
  const newCount     = [...selectedIds].filter(id => !prevIds.has(id)).length;
  const removedCount = [...prevIds].filter(id => !selectedIds.has(id)).length;
  const dirty        = newCount > 0 || removedCount > 0;
  const ctaLabel     = newCount > 0 && removedCount === 0
    ? `Agregar ${newCount} ${newCount === 1 ? 'jugador' : 'jugadores'}`
    : dirty ? 'Actualizar selección' : 'Agregar jugadores';

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <TopBar title="Agregar jugadores" onCancel={onCancel} rightNode={
        gameId ? (
          <button
            onClick={() => shareOrCopy({ url: `${window.location.origin}/game/${gameId}`, onCopied: () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } })}
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
          </div>
        )}

        {q && !noMatchAtAll && listBelow.map(p => (
          <PlayerRow key={p.id} p={p} checked={false} onToggle={() => toggle(p.id)} />
        ))}

        {!q && hasAnyData && listBelow.length > 0 && (
          <>
            <div style={{ padding: '10px 16px 4px', fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M7 1l1.5 3.4 3.7.3-2.7 2.4.8 3.7L7 9l-3.3 1.8.8-3.7L1.8 4.7l3.7-.3L7 1z" fill={ORANGE} stroke={ORANGE} strokeWidth="0.5"/>
              </svg>
              Favoritos
            </div>
            {listBelow.map(p => (
              <PlayerRow key={p.id} p={p} checked={false} onToggle={() => toggle(p.id)} />
            ))}
          </>
        )}

      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }}>
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

function MethodRow({ active, onSelect, accentColor, icon, label, children }) {
  return (
    <div style={{ marginBottom: 10, borderRadius: 14, border: `1.5px solid ${active ? accentColor : HAIR}` }}>
      <button
        onClick={onSelect}
        style={{ width: '100%', height: 52, padding: '0 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit' }}>
        {icon}
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1, textAlign: 'left' }}>{label}</span>
        <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? accentColor : '#C7C7CC'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor }} />}
        </div>
      </button>
      {active && children && (
        <div style={{ padding: '4px 14px 14px', borderTop: `1px solid ${HAIR}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

function PaymentSheet({ amount, currency = 'S/.', label, onClose, onPaid }) {
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

  function pay() {
    if (!canPay || paying !== 'idle') return;
    setPaying('loading');
    setTimeout(() => {
      setPaying('confirming');
      setTimeout(() => {
        const approved = Math.random() < 0.8;
        if (approved) {
          setOpen(false);
          setTimeout(() => { setPaying('idle'); onPaid?.(activeTab); }, 260);
        } else {
          setPaying('rejected');
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
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        overflow: 'hidden',
      }}>
      <div style={{
        position: 'relative', background: '#FAFAFA',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.18)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
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
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'none', padding: '14px 16px 0' }}>
          <div style={{ paddingBottom: 14 }}>
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
            <div style={{ marginTop: 8, display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: `${YAPE}18`, border: `1px solid ${YAPE}40`, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: YAPE, fontWeight: 700, marginBottom: 4 }}>1. Abre Yape</div>
                <div style={{ fontSize: 11, color: SUB, lineHeight: 1.4 }}>Toca "Aprobar compras" en tu app Yape</div>
              </div>
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: `${YAPE}18`, border: `1px solid ${YAPE}40`, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: YAPE, fontWeight: 700, marginBottom: 4 }}>2. Ingresa el código</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace, monospace', letterSpacing: 2 }}>––––––</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', overflow: 'hidden', marginBottom: 10 }}>
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
          <MethodRow
            active={activeTab === 'native'}
            onSelect={() => setActiveTab('native')}
            accentColor="#1B1B1F"
            icon={nativeIcon}
            label={nativeLabel}
          />

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
        <div style={{
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

export default function ConfirmReservation() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const game = state?.game;
  const user = state?.user ?? { name: 'Usuario', email: 'usuario@email.com' };

  const [guests, setGuests]         = useState([]);
  const [subView, setSubView]       = useState('confirm');
  const [payOpen, setPayOpen]       = useState(false);
  const [paidPlayers, setPaidPlayers] = useState([]);
  const reservationTs               = useRef(Date.now());

  useEffect(() => {
    getPaidStatus().then(data => setPaidPlayers(data));
    getCredit().then(c => setCreditBalance(Math.max(0, c?.balance || 0)));
  }, []);

  const [promoOpen, setPromoOpen]       = useState(false);
  const [promoInput, setPromoInput]     = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoError, setPromoError]     = useState('');
  const [freeConfirming, setFreeConfirming] = useState(false);

  const rosterPlayerIds = useMemo(() => new Set(getActivePlayers(game?.id || '').map(p => p.id)), [game?.id]);

  const isCampo       = game?.source === 'campo';
  const addGuestsMode = game?.addGuestsMode ?? false;
  const maxNewGuests  = game?.maxNewGuests  ?? 99;
  const rawSpots      = game?.openSpots;
  const guestSlots    = addGuestsMode ? maxNewGuests : (rawSpots != null ? Math.max(0, rawSpots - 1) : undefined);
  const displaySpots  = guestSlots;
  const spotsLabel    = (() => {
    if (addGuestsMode) {
      if (displaySpots === undefined) return null;
      if (displaySpots === 0) return 'No quedan más cupos disponibles';
      return `Solo ${displaySpots === 1 ? 'queda 1 cupo disponible' : `quedan ${displaySpots} cupos disponibles`}`;
    }
    if (rawSpots == null) return null;
    if (rawSpots === 0) return 'No quedan más cupos disponibles';
    return `Solo ${rawSpots === 1 ? 'queda 1 cupo disponible' : `quedan ${rawSpots} cupos disponibles`}`;
  })();
  const unitPrice = game?.priceNumber ?? 0;
  const [creditBalance, setCreditBalance] = useState(0);
  const currency  = game?.currency ?? 'S/.';
  const fmt = n => `${currency} ${Number(n || 0).toFixed(2)}`;

  const titularNet   = unitPrice - (promoApplied?.discount ?? 0);
  const guestsTotal  = guests.length * unitPrice;
  const subtotal     = addGuestsMode ? Math.max(0, guestsTotal) : Math.max(0, titularNet + guestsTotal);
  const creditApplied = Math.min(creditBalance, subtotal);
  const total        = Math.max(0, subtotal - creditApplied);

  const unitStr  = fmt(unitPrice);
  const totalStr = addGuestsMode
    ? fmt(total)
    : (promoApplied || guests.length > 0 || creditApplied > 0) ? fmt(total) : unitStr;
  const seats = addGuestsMode ? guests.length : 1 + guests.length;

  function applyCode() {
    const { discount, def } = applyPromo(unitPrice, promoInput);
    if (!def) { setPromoApplied(null); setPromoError('Código no válido'); return; }
    setPromoApplied({ ...def, discount });
    setPromoError('');
  }

  function handleConfirm() {
    if (total === 0) {
      setFreeConfirming(true);
      setTimeout(() => handlePaid(), 1800);
      return;
    }
    setPayOpen(true);
  }

  async function handlePaid(paymentMethod) {
    setPayOpen(false);
    if (addGuestsMode) {
      const gameId = game?.id;
      if (gameId && guests.length > 0) {
        const existing = await getPaidStatus();
        const existingIds = new Set(existing.map(p => p.id));
        const toAdd = guests.filter(g => !existingIds.has(g.id)).map(g => ({ id: g.id, name: g.name, hue: g.hue, code: g.code || '', paidAt: Date.now() }));
        if (toAdd.length > 0) { await setPaidStatus([...existing, ...toAdd]); setPaidPlayers(p => [...p, ...toAdd]); }
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
        if (creditApplied > 0) {
          const credit = await getCredit();
          credit.balance = Math.max(0, (credit.balance || 0) - creditApplied);
          credit.transactions = [
            { id: 'tx-use-' + Date.now(), amount: -creditApplied, reason: 'Crédito aplicado en reserva', createdAt: new Date().toISOString() },
            ...(credit.transactions || []),
          ];
          await setCredit(credit);
        }
        const res = await getReservations();
        const idx = res.findIndex(r => r.id === gameId);
        if (idx >= 0) {
          const old = res[idx];
          const oldBreak = old.paymentBreakdown || { unitPrice, discount: 0, guestsCount: 0, guestsTotal: 0, total: unitPrice };
          res[idx] = { ...old, paymentBreakdown: { ...oldBreak, guestsCount: oldBreak.guestsCount + guests.length, guestsTotal: oldBreak.guestsTotal + guestsTotal, total: oldBreak.total + guestsTotal }, price: `S/. ${(oldBreak.total + guestsTotal).toFixed(2)}` };
          await setReservations(res);
        }
      }
      navigate('/profile');
      return;
    }
    if (guests.length > 0) {
      const existing = await getPaidStatus();
      const existingIds = new Set(existing.map(p => p.id));
      const toAdd = guests
        .filter(g => !existingIds.has(g.id))
        .map(g => ({ id: g.id, name: g.name, hue: g.hue, code: g.code || '', paidAt: Date.now() }));
      if (toAdd.length > 0) {
        const updated = [...existing, ...toAdd];
        await setPaidStatus(updated);
        setPaidPlayers(updated);
      }
      const _gid = game?.id;
      if (_gid) {
        const _payerProfile = (() => { try { return JSON.parse(localStorage.getItem('pichanga_profile') || '{}'); } catch { return {}; } })();
        createRoster(_gid, guests, {
          reservedAt: reservationTs.current,
          payerName: _payerProfile.fullName || 'Usuario',
          payerCode: _payerProfile.userCode  || '',
        });
      }
    }
    if (creditApplied > 0) {
      const credit = await getCredit();
      credit.balance = Math.max(0, (credit.balance || 0) - creditApplied);
      credit.transactions = [
        { id: 'tx-use-' + Date.now(), amount: -creditApplied, reason: 'Crédito aplicado en reserva', createdAt: new Date().toISOString() },
        ...(credit.transactions || []),
      ];
      await setCredit(credit);
    }
    if (guests.length === 0) {
      createReservation({
        gameId:        game?.id,
        unitPrice,
        promoCode:     promoApplied?.code    ?? null,
        promoDiscount: promoApplied?.discount ?? 0,
        totalAmount:   total,
        paymentMethod,
        source:        game?.source ?? 'match',
      }).then(({ data, error, skipped }) => {
        if (skipped) return; // no Supabase session (mock user) — localStorage fallback active
        if (error)   console.warn('[checkout] Supabase reservation failed:', error);
        else         console.log('[checkout] Supabase reservation created:', data?.id);
      });
    }
    navigate('/profile', { state: { confirmedGame: {
      id:           game?.id,
      field:        game?.field,
      date:         game?.date,
      time:         game?.time,
      format:       game?.format || '7v7',
      amount:       total,
      price:        game?.price,
      source:       game?.source,
      unitPrice:    unitPrice,
      promoDiscount: promoApplied?.discount ?? 0,
      creditApplied: creditApplied,
      discount:     (promoApplied?.discount ?? 0) + creditApplied,
      guestsCount:  guests.length,
      guestsTotal:  guestsTotal,
    }}});
  }

  if (subView === 'addplayers') {
    return (
      <AddPlayersScreen
        alreadySelected={guests}
        onCancel={() => setSubView('confirm')}
        onConfirm={selected => { setGuests(selected); setSubView('confirm'); }}
        paidPlayers={paidPlayers}
        maxGuests={guestSlots ?? 99}
        spotsCount={addGuestsMode ? (maxNewGuests < 99 ? maxNewGuests : undefined) : rawSpots}
        isInscribed={addGuestsMode}
        gameId={game?.id}
        rosterPlayerIds={rosterPlayerIds}
      />
    );
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', position: 'relative' }}>
      <TopBar
        title={addGuestsMode ? 'Agregar invitados' : 'Confirmación de reserva'}
        onCancel={() => {
          if (addGuestsMode) { navigate(-1); return; }
          const dest = game?.backPath ?? (game?.source === 'campo' ? '/fields' : '/games');
          if (game?.gameDetailBackPath && dest.startsWith('/game/')) {
            navigate(dest, { state: { backPath: game.gameDetailBackPath } });
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
                <div style={{ marginTop: 2, fontSize: 13.5, color: SUB, lineHeight: 1.4 }}>{game.time} · {game.duration}</div>
              </div>
            </div>
          </>
        )}

        {!isCampo && !addGuestsMode && (
          <div style={{ padding: '24px 16px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, letterSpacing: -0.1 }}>
              Reservando {seats} {seats === 1 ? 'lugar' : 'lugares'} para
            </div>
          </div>
        )}

        {!isCampo && !addGuestsMode && (
          <div style={{ padding: '12px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <UserAvatar size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 12.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{unitStr}</div>
            </div>
          </div>
        )}

        {!isCampo && guests.length > 0 && (
          <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {guests.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <Avatar name={g.name} hue={g.hue} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
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

        {!isCampo && (
          <div style={{ padding: '18px 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {(() => {
              const noSlots = displaySpots === 0;
              const btnColor = noSlots ? '#C4C4CC' : ORANGE;
              return (
                <button
                  onClick={noSlots ? undefined : () => setSubView('addplayers')}
                  style={{ padding: '10px 14px', background: 'transparent', border: 'none', cursor: noSlots ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: btnColor, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none', opacity: noSlots ? 0.5 : 1 }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="9" stroke={btnColor} strokeWidth="1.6"/>
                    <path d="M10 6v8M6 10h8" stroke={btnColor} strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                  Agregar jugadores
                </button>
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

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        {!promoOpen && !promoApplied && !addGuestsMode && (
          <button onClick={() => setPromoOpen(true)} style={{ padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: ORANGE, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 6, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 7.5V2.5h5l7 7-5 5-7-7z" stroke={ORANGE} strokeWidth="1.4" strokeLinejoin="round"/>
              <circle cx="5.4" cy="5.4" r="0.9" fill={ORANGE}/>
            </svg>
            Código promocional
          </button>
        )}

        {promoOpen && !promoApplied && !addGuestsMode && (
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
              <button onClick={applyCode} disabled={!promoInput.trim()} style={{ height: 42, padding: '0 16px', borderRadius: 10, background: promoInput.trim() ? TEXT : '#E8E8EC', color: promoInput.trim() ? '#fff' : '#9A9AA0', border: 'none', cursor: promoInput.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, flexShrink: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Aplicar
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
          {!addGuestsMode && (promoApplied || guests.length > 0 || creditApplied > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>Titular</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{unitStr}</span>
            </div>
          )}
          {!addGuestsMode && promoApplied && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
              <span>Descuento{promoApplied.kind === 'percent' ? ` · ${promoApplied.value}%` : ''}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{fmt(promoApplied.discount)}</span>
            </div>
          )}
          {guests.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>Invitados ({guests.length})</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(guestsTotal)}</span>
            </div>
          )}
          {creditApplied > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
                <span>Crédito aplicado</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{fmt(creditApplied)}</span>
              </div>
              <div style={{ fontSize: 11, color: SUB }}>Saldo disponible: {fmt(creditBalance)}</div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: (promoApplied || guests.length > 0 || creditApplied > 0) ? 8 : 0, borderTop: (promoApplied || guests.length > 0 || creditApplied > 0) ? `1px solid ${HAIR}` : 'none', marginTop: (promoApplied || guests.length > 0 || creditApplied > 0) ? 4 : 0, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>
            <span>Total</span>
            <span style={{ whiteSpace: 'nowrap' }}>{totalStr}</span>
          </div>
        </div>

        <CtaButton onPress={handleConfirm} disabled={addGuestsMode && guests.length === 0}>Confirmar</CtaButton>
      </div>

      {payOpen && (
        <PaymentSheet
          amount={total}
          currency={currency}
          label={totalStr}
          onClose={() => setPayOpen(false)}
          onPaid={handlePaid}
        />
      )}

      {freeConfirming && (
        <div style={{
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
    </div>
  );
}
