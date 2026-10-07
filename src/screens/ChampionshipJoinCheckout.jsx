import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE, SOFT } from '../constants';
import { CtaButton, TopBar } from '../components/checkout/CheckoutUI';
import { Avatar, PlayerRow } from '../components/checkout/PlayerPickerUI';
import PaymentSheet from '../components/checkout/PaymentSheet';
import { soles } from '../data/championshipCheckoutMock';
import { uuidv4 } from '../lib/uuid';
import { useAuth } from '../context/AuthContext';
import { searchUsers, getWalletBalance, getRewardBalance } from '../services/reservationService';
import { createChampionshipRegistrationOrder, confirmChampionshipRegistration, failChampionshipRegistration, getChampionshipRegistrationState } from '../services/championshipService';

// Errores backend → copy controlado.
function regErrorMessage(msg) {
  const m = String(msg || '');
  if (/ALREADY_ENROLLED/.test(m)) return 'Tú o algún invitado ya está inscrito en este campeonato.';
  if (/PUBLIC_CHAMPIONSHIP_PAYMENT_REQUIRED/.test(m)) return 'Esta inscripción es de pago. Vuelve a intentarlo desde aquí.';
  if (/ORDER_EXPIRED/.test(m)) return 'El tiempo para completar la inscripción terminó. Vuelve a intentarlo.';
  if (/AVAILABILITY_CHANGED/.test(m)) return 'La disponibilidad cambió. Vuelve a intentarlo.';
  if (/NOT_OPEN/.test(m)) return 'Las inscripciones no están abiertas.';
  if (/NOT_PUBLIC/.test(m)) return 'Este campeonato no admite inscripción individual.';
  if (/INSUFFICIENT_CREDIT|CREDIT_EXCEEDS_TOTAL|INVALID_CREDIT|INSUFFICIENT_REWARD|REWARD_/.test(m)) return 'Tu saldo cambió. Vuelve a intentarlo.';
  return 'No pudimos procesar la inscripción. Inténtalo de nuevo.';
}

// ── Subpantalla "Agregar jugadores" ── MISMA UX visual que Match (AddPlayersScreen), pero
// mínima para campeonato: sin cupos/roster/host/favoritos. self nunca aparece (excludeIds).
function JoinAddPlayers({ alreadySelected, selfId, enrolledIds = [], ownerId = null, onCancel, onConfirm }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => alreadySelected);
  const [results, setResults] = useState([]);
  const [dupMsg, setDupMsg] = useState('');            // toast local "no seleccionable" (patrón Match)
  const reqRef = useRef(0);
  const dupRef = useRef(0);
  const q = query.trim();
  const enrolledSet = new Set(enrolledIds);
  const flashDup = (m) => { setDupMsg(m); clearTimeout(dupRef.current); dupRef.current = setTimeout(() => setDupMsg(''), 2500); };
  // Motivo por el que una fila NO es seleccionable (igual que Match: organizador / ya inscrito).
  const disabledReason = (p) => (ownerId && p.id === ownerId) ? 'El organizador no puede añadirse como jugador.'
    : enrolledSet.has(p.id) ? 'Este jugador ya está inscrito en el campeonato.' : '';

  useEffect(() => {
    const reqId = ++reqRef.current;
    const t = setTimeout(() => {
      if (q.length < 2) { if (reqId === reqRef.current) setResults([]); return; }
      searchUsers(q, { excludeIds: [selfId] }).then(rows => {
        if (reqId !== reqRef.current) return;
        setResults(rows || []);
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q, selfId]);

  const selIds = new Set(selected.map(p => p.id));
  const toggle = (p) => {
    const r = disabledReason(p);
    if (r) { flashDup(r); return; }   // no seleccionable → solo feedback, no se añade
    setSelected(prev => prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p]);
  };
  const listBelow = results.filter(p => !selIds.has(p.id));
  const noMatch = q.length >= 2 && results.length === 0;

  const prevIds = new Set(alreadySelected.map(p => p.id));
  const added = selected.filter(p => !prevIds.has(p.id)).length;
  const removed = alreadySelected.filter(p => !selIds.has(p.id)).length;
  const dirty = added > 0 || removed > 0;
  const ctaLabel = added > 0 && removed === 0 ? `Agregar ${added} ${added === 1 ? 'jugador' : 'jugadores'}` : dirty ? 'Actualizar selección' : 'Agregar jugadores';

  return (
    <div className="add-players-screen" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <TopBar title="Agregar jugadores" onCancel={onCancel} />
      <div style={{ padding: '8px 16px 4px' }}>
        <div style={{ height: 44, padding: '0 12px', borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="8" cy="8" r="5.4" stroke={SUB} strokeWidth="1.6"/>
            <path d="M12 12l3.4 3.4" stroke={SUB} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o @ID"
            style={{ flex: 1, minWidth: 0, height: '100%', padding: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: TEXT }} />
          {q && (
            <button onClick={() => setQuery('')} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#C4C4CC"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      </div>

      <div className="no-sb" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {selected.length > 0 && (
          <>
            <div style={{ padding: '10px 16px 4px', fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.8" stroke={ORANGE} strokeWidth="1.4"/><path d="M4 7.2l2 2L10 5" stroke={ORANGE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Seleccionados · {selected.length}
            </div>
            {selected.map(p => <PlayerRow key={p.id} p={p} checked onToggle={() => toggle(p)} />)}
          </>
        )}
        {noMatch && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>Ningún jugador coincide con "{query}".</div>
        )}
        {q.length >= 2 && !noMatch && listBelow.map(p => { const r = disabledReason(p); return <PlayerRow key={p.id} p={p} checked={false} disabled={!!r} subtitle={r ? (p.id === ownerId ? 'Organizador' : 'Ya inscrito') : null} onToggle={() => toggle(p)} />; })}
        {q.length < 2 && selected.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>Busca jugadores por nombre o @ID para agregarlos.</div>
        )}
      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        <CtaButton onPress={() => onConfirm(selected)} disabled={!dirty}>{ctaLabel}</CtaButton>
      </div>

      {/* Toast "no seleccionable" (mismo feedback que Match: organizador / ya inscrito). */}
      {dupMsg && (
        <div style={{ position: 'fixed', left: '50%', bottom: 140, transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 16px', borderRadius: 20, zIndex: 9999, pointerEvents: 'none', maxWidth: '84%', textAlign: 'center' }}>{dupMsg}</div>
      )}
    </div>
  );
}

// Inscripción INDIVIDUAL pagada a un campeonato PÚBLICO. MISMA experiencia que el checkout de
// Match (ConfirmReservation): header, bloque titular + invitados, agregar jugadores, reward,
// crédito, resumen, CTA y overlay de confirmación. Diferencias SOLO de dominio (campeonato,
// championship_players team_id NULL; el payer paga a todos). Sin armar lista/capitán/R1/cupos.
export default function ChampionshipJoinCheckout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const nav = location.state || {};
  const championshipId = nav.championshipId || null;
  const championshipName = nav.championshipName || 'Campeonato';
  const unitPrice = Number(nav.unitPrice) || 0;

  // cvReturn → ChampionshipView restaura el scroll guardado por persistCV (mismo patrón que ChampionshipTeam).
  const back = () => navigate(championshipId ? `/championships/view/${championshipId}` : '/championships', championshipId ? { state: { cvReturn: true } } : undefined);
  useEffect(() => { if (!championshipId || !unitPrice) back(); }, []); // eslint-disable-line

  const [subView, setSubView] = useState('confirm');
  const [guests, setGuests] = useState([]);   // [{id, name, code, hue, avatarPath, avatarVersion}]
  const userIds = [user?.id, ...guests.map(g => g.id)].filter(Boolean);
  // Inscritos + organizador del campeonato → para marcar no seleccionables en "Agregar jugadores" (patrón Match).
  // Lectura pública del estado (registration_open). El backend igualmente rechaza (ALREADY_ENROLLED); esto es UX.
  const [enrolledIds, setEnrolledIds] = useState([]);
  const [ownerId, setOwnerId] = useState(null);
  useEffect(() => {
    if (!championshipId) return;
    getChampionshipRegistrationState({ championshipId }).then(({ data }) => {
      if (!data) return;
      setEnrolledIds((data.players || []).map(p => p.user_id).filter(Boolean));
      setOwnerId(data.owner_user_id || null);
    }).catch(() => {});
  }, [championshipId]);
  const count = userIds.length;
  const gross = Math.round(unitPrice * count * 100) / 100;

  // ── Recompensas (Reward): OPCIONAL, SOLO el payer, tope min(saldo, unitPrice). Igual que Match. ──
  const [rewardBalance, setRewardBalance] = useState(0);
  const [usingReward, setUsingReward] = useState(false);
  // ── Crédito (wallet): auto-aplicado y NO removible, igual que Match. Backend = autoridad del monto. ──
  const [creditBalance, setCreditBalance] = useState(0);
  // Resolución financiera (wallet + rewards): hasta tener ambos saldos, el total/credit/external no son definitivos.
  // Confirmar debe estar DESHABILITADO mientras no estén resueltos (mismo principio que Match/ConfirmReservation,
  // donde Confirmar se gatea con creditLoading). Un fallo de lectura deja financialReady=false → no se confirma con
  // información financiera incompleta (reintento por remount/usuario).
  const [rewardResolved, setRewardResolved] = useState(false);
  const [creditResolved, setCreditResolved] = useState(false);
  const financialReady = rewardResolved && creditResolved;
  useEffect(() => {
    let alive = true;
    getRewardBalance().then(b => { if (alive) { setRewardBalance(Math.max(0, Number(b) || 0)); setRewardResolved(true); } }).catch(() => {});
    getWalletBalance().then(b => { if (alive) { setCreditBalance(Math.max(0, Number(b) || 0)); setCreditResolved(true); } }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  const rewardApplied = usingReward ? Math.min(rewardBalance, unitPrice) : 0;
  const total = Math.round((gross - rewardApplied) * 100) / 100;
  const creditApplied = (creditBalance > 0 && total > 0) ? Math.min(creditBalance, total) : 0;
  const externalAmount = Math.round((total - creditApplied) * 100) / 100;
  const guestsTotal = Math.round(guests.length * unitPrice * 100) / 100;
  // Sin importe externo (100% crédito y/o reward) → NO se abre PaymentSheet; igual se crea order + confirm.
  const noExternal = externalAmount === 0;

  const [payOpen, setPayOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmSlow, setConfirmSlow] = useState(false);
  const [err, setErr] = useState(null);
  const orderRef = useRef({ key: null });
  const slowTimer = useRef(null);

  const startConfirming = () => {
    setConfirming(true); setConfirmSlow(false); setErr(null);
    slowTimer.current = setTimeout(() => setConfirmSlow(true), 6000);
  };
  const stopConfirming = () => { setConfirming(false); setConfirmSlow(false); if (slowTimer.current) clearTimeout(slowTimer.current); };
  useEffect(() => () => { if (slowTimer.current) clearTimeout(slowTimer.current); }, []);

  const buildConfig = (method) => ({ payment_method: method, credit_applied: creditApplied, reward_applied: rewardApplied });

  // Pasarela: crea la order (pending) al pulsar Pagar, antes del mock del cobro.
  const gatewayPreCharge = async (method) => {
    const o = orderRef.current; if (!o.key) o.key = uuidv4();
    const { error } = await createChampionshipRegistrationOrder({ championshipId, idempotencyKey: o.key, userIds, config: buildConfig(method || 'gateway') });
    if (error) {
      if (/ALREADY_ENROLLED|AVAILABILITY_CHANGED|NOT_OPEN/.test(error.message || '')) { orderRef.current = { key: null }; return { error: 'AVAILABILITY_CHANGED' }; }
      return { error: error.message || 'NETWORK' };
    }
    return { championshipId };
  };
  const gatewayPaid = async () => {
    setPayOpen(false); startConfirming();
    const { error } = await confirmChampionshipRegistration({ championshipId, idempotencyKey: orderRef.current.key });
    if (error) {
      stopConfirming();
      const m = error.message || '';
      // Terminal (no reintentar con la misma order): soltar la key. Mostrar el mensaje en pantalla
      // (NO navegar en silencio); la inscripción NO se materializó.
      if (/AVAILABILITY_CHANGED|NOT_OPEN|ALREADY_ENROLLED|ORDER_EXPIRED|REWARD_/.test(m)) orderRef.current = { key: null };
      setErr(regErrorMessage(m));
      return;
    }
    orderRef.current = { key: null };
    done();
  };
  const gatewayRejected = async () => {
    if (orderRef.current.key) await failChampionshipRegistration({ championshipId, idempotencyKey: orderRef.current.key, reason: 'payment_rejected' });
    orderRef.current = { key: null };
  };
  const availabilityBack = () => { setPayOpen(false); back(); };

  // Sin importe externo (100% crédito y/o reward): sin pasarela → crear order + confirmar directo.
  const payWithCredit = async () => {
    if (confirming) return; startConfirming();
    const o = orderRef.current; if (!o.key) o.key = uuidv4();
    const { error } = await createChampionshipRegistrationOrder({ championshipId, idempotencyKey: o.key, userIds, config: buildConfig('credit') });
    if (error) { stopConfirming(); setErr(regErrorMessage(error.message)); if (/ALREADY_ENROLLED|AVAILABILITY_CHANGED/.test(error.message || '')) orderRef.current = { key: null }; return; }
    const { error: cErr } = await confirmChampionshipRegistration({ championshipId, idempotencyKey: o.key });
    if (cErr) { stopConfirming(); orderRef.current = { key: null }; setErr(regErrorMessage(cErr.message)); return; }
    orderRef.current = { key: null };
    done();
  };

  const done = () => navigate('/profile', { replace: true, state: { champConfirm: 'joined', championshipId } });

  // ── Subpantalla Agregar jugadores ──
  if (subView === 'addplayers') {
    return (
      <div className="screen-shell" style={{ position: 'relative', overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <JoinAddPlayers
          alreadySelected={guests}
          selfId={user?.id}
          enrolledIds={enrolledIds}
          ownerId={ownerId}
          onCancel={() => setSubView('confirm')}
          onConfirm={(selected) => { setGuests(selected); setSubView('confirm'); }}
        />
      </div>
    );
  }

  const selfName = user?.name || 'Tú';

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', position: 'relative' }}>
      <TopBar title="Confirmación de inscripción" onCancel={back} />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'none' }}>
        {/* Header de dominio: nombre del campeonato (como el venue en Match) + precio unitario */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: TEXT, letterSpacing: -0.6, lineHeight: 1.1 }}>{championshipName}</div>
          <div style={{ marginTop: 6, fontSize: 13.5, color: SUB }}>Inscripción individual · {soles(unitPrice)} por persona</div>
        </div>

        <div style={{ padding: '24px 16px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, letterSpacing: -0.1 }}>
            Inscribiendo {count} {count === 1 ? 'jugador' : 'jugadores'}
          </div>
        </div>

        {/* Titular (self) */}
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
            <Avatar name={selfName} hue={210} size={44} avatarPath={user?.avatarPath ?? null} avatarVersion={user?.avatarVersion ?? null} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selfName} <span style={{ color: SUB, fontWeight: 600 }}>(Tú)</span></div>
              {user?.email && <div style={{ fontSize: 12.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{soles(unitPrice)}</div>
          </div>
        </div>

        {/* Invitados (mismo diseño de fila que Match) */}
        {guests.length > 0 && (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
            {guests.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <Avatar name={g.name} hue={g.hue} size={44} avatarPath={g.avatarPath ?? null} avatarVersion={g.avatarVersion ?? null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  {g.code && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{g.code}</div>}
                </div>
                <button onClick={() => setGuests(gs => gs.filter(x => x.id !== g.id))} style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" fill="#FCEAEB"/><path d="M7 7l6 6M13 7l-6 6" stroke="#E5484D" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
                <div style={{ fontSize: 14, fontWeight: 600, color: SUB, flexShrink: 0 }}>{soles(unitPrice)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Agregar jugadores (mismo botón + "Pagas tú") */}
        <div style={{ padding: '18px 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setSubView('addplayers')} style={{ padding: '10px 4px 10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: ORANGE, letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke={ORANGE} strokeWidth="1.6"/><path d="M10 6v8M6 10h8" stroke={ORANGE} strokeWidth="1.7" strokeLinecap="round"/></svg>
              Agregar jugadores
            </button>
            <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>Pagas tú</span>
          </div>
        </div>
        <div style={{ height: 8 }} />
      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        {/* Recompensas: toggle opcional, mismo control/copy que Match (solo payer, tope unitPrice). */}
        {rewardBalance > 0 && (
          usingReward ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, background: '#EEEBFB', border: '1px solid #D6CEF7', borderRadius: 10 }}>
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="#6D5AE6"/><path d="M5 9.2l2.6 2.6L13 6.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <div style={{ flex: 1, fontSize: 13, color: '#4B3BAF', fontWeight: 600 }}>Recompensas aplicadas (−{soles(rewardApplied)})</div>
              <button onClick={() => setUsingReward(false)} style={{ padding: '2px 6px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#4B3BAF', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Quitar</button>
            </div>
          ) : (
            <button onClick={() => setUsingReward(true)} style={{ padding: '6px 4px', marginBottom: 2, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: '#6D5AE6', letterSpacing: -0.1, display: 'inline-flex', alignItems: 'center', gap: 6, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9 4.3 13.4l.7-4.3-3.1-3 4.3-.6z" stroke="#6D5AE6" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              Usar mis recompensas ({soles(rewardBalance)})
            </button>
          )
        )}

        {/* Resumen económico — MISMO orden/labels/estilos que Match (ConfirmReservation). */}
        <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
            <span>Titular</span>
            <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(unitPrice)}</span>
          </div>
          {rewardApplied > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#6D5AE6' }}>
              <span>Recompensas</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{soles(rewardApplied)}</span>
            </div>
          )}
          {guests.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>Invitados ({guests.length})</span>
              <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(guestsTotal)}</span>
            </div>
          )}
          {creditApplied > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#1F6B36' }}>
                <span>Crédito aplicado</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{soles(creditApplied)}</span>
              </div>
              <div style={{ fontSize: 11, color: SUB }}>Saldo disponible: {soles(creditBalance)}</div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 8, borderTop: `1px solid ${HAIR}`, marginTop: 4, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>
            <span>Total</span>
            <span style={{ whiteSpace: 'nowrap' }}>{soles(externalAmount)}</span>
          </div>
        </div>

        {err && <div style={{ fontSize: 12.5, color: '#C0392B', padding: '0 0 8px' }}>{err}</div>}
        <CtaButton onPress={noExternal ? payWithCredit : () => setPayOpen(true)} disabled={total <= 0 || confirming || !financialReady}>
          {confirming ? 'Procesando...' : !financialReady ? 'Calculando…' : 'Confirmar'}
        </CtaButton>
      </div>

      {payOpen && (
        <PaymentSheet
          amount={externalAmount}
          currency="S/"
          label={soles(externalAmount)}
          onClose={() => setPayOpen(false)}
          onPreCharge={gatewayPreCharge}
          onPaid={gatewayPaid}
          onRejected={gatewayRejected}
          onAvailabilityChanged={availabilityBack}
        />
      )}

      {/* Overlay de confirmación: MISMO patrón visual que Match ("Estamos confirmando…"). */}
      {confirming && (
        <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,15,0.88)', padding: '0 32px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.2)', borderTop: '4px solid #fff', animation: 'spin 0.9s linear infinite', marginBottom: 28 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3 }}>
            {confirmSlow ? 'Está tardando más de lo habitual' : 'Estamos confirmando tu inscripción...'}
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            {confirmSlow ? 'Estamos verificando el estado de tu inscripción.' : 'No cierres esta pantalla.'}
          </div>
        </div>
      )}
    </div>
  );
}
