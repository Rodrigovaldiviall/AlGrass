import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE, BLUE } from '../constants';
import { CtaButton, TopBar } from '../components/checkout/CheckoutUI';
import PaymentSheet from '../components/checkout/PaymentSheet';
import Shield, { DesignSwatch } from '../components/championship/Shield';
import { TEAM_DESIGNS, DEFAULT_DESIGN, withinTeamNameWordLimit } from '../data/championshipTeamsMock';
import { soles } from '../data/championshipCheckoutMock';
import { uuidv4 } from '../lib/uuid';
import { useAuth } from '../context/AuthContext';
import { getWalletBalance, getRewardBalance } from '../services/reservationService';
import { createChampionshipTeamRegistrationOrder, confirmChampionshipTeamRegistration, failChampionshipTeamRegistration } from '../services/championshipService';

function regErrorMessage(msg) {
  const m = String(msg || '');
  if (/TEAM_NAME_REQUIRED/.test(m)) return 'Ponle un nombre al equipo.';
  if (/TEAM_SECRET_REQUIRED/.test(m)) return 'Define una clave para el equipo.';
  if (/ALREADY_ENROLLED/.test(m)) return 'Ya estás inscrito en este campeonato. Cancela tu inscripción actual primero.';
  if (/ACTIVE_INDIVIDUAL_RESERVATION/.test(m)) return 'Ya tienes una reserva individual activa en este campeonato.';
  if (/PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED/.test(m)) return 'La creación de equipo es de pago. Vuelve a intentarlo desde aquí.';
  if (/ORDER_EXPIRED/.test(m)) return 'El tiempo para completar la creación terminó. Vuelve a intentarlo.';
  if (/AVAILABILITY_CHANGED/.test(m)) return 'La disponibilidad cambió. Vuelve a intentarlo.';
  if (/NOT_OPEN/.test(m)) return 'Las inscripciones no están abiertas.';
  if (/NOT_PUBLIC/.test(m)) return 'Este campeonato no admite creación de equipo de pago.';
  if (/INSUFFICIENT_CREDIT|CREDIT_EXCEEDS_TOTAL|INVALID_CREDIT|INSUFFICIENT_REWARD|REWARD_/.test(m)) return 'Tu saldo cambió. Vuelve a intentarlo.';
  return 'No pudimos crear el equipo. Inténtalo de nuevo.';
}

// Inscripción PAGADA por EQUIPO (crear equipo) en campeonato PÚBLICO. UNA unidad = public_team_price;
// el creador paga. NO agrega jugadores (los miembros se unen después por clave/link). El equipo
// NO se crea hasta CONFIRMAR el pago (create solo congela nombre/color/diseño + hash de clave).
export default function ChampionshipTeamCheckout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const nav = location.state || {};
  const championshipId = nav.championshipId || null;
  const championshipName = nav.championshipName || 'Campeonato';
  const unitPrice = Number(nav.unitPrice) || 0;   // public_team_price (autoridad backend; aquí solo UI)

  // cvReturn → ChampionshipView restaura el scroll guardado por persistCV (mismo patrón que ChampionshipTeam).
  const back = () => navigate(championshipId ? `/championships/view/${championshipId}` : '/championships', championshipId ? { state: { cvReturn: true } } : undefined);
  useEffect(() => { if (!championshipId || !unitPrice) back(); }, []); // eslint-disable-line

  // ── Datos del equipo ──
  const [name, setName] = useState('');
  const [design, setDesign] = useState(DEFAULT_DESIGN);
  const [secret, setSecret] = useState('');
  const nameOk = name.trim().length > 0;
  const secretOk = secret.trim().length >= 4;

  // ── Recompensas (opcional, tope = unit) + crédito (auto, no removible). Igual que Match/individual. ──
  const [rewardBalance, setRewardBalance] = useState(0);
  const [usingReward, setUsingReward] = useState(false);
  const [creditBalance, setCreditBalance] = useState(0);
  useEffect(() => {
    let alive = true;
    getRewardBalance().then(b => { if (alive) setRewardBalance(Math.max(0, Number(b) || 0)); }).catch(() => {});
    getWalletBalance().then(b => { if (alive) setCreditBalance(Math.max(0, Number(b) || 0)); }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  const rewardApplied = usingReward ? Math.min(rewardBalance, unitPrice) : 0;
  const total = Math.round((unitPrice - rewardApplied) * 100) / 100;
  const creditApplied = (creditBalance > 0 && total > 0) ? Math.min(creditBalance, total) : 0;
  const externalAmount = Math.round((total - creditApplied) * 100) / 100;
  const noExternal = externalAmount === 0;

  const [payOpen, setPayOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmSlow, setConfirmSlow] = useState(false);
  const [err, setErr] = useState(null);                 // error PRE-confirm (create) → inline (sin order/sin riesgo)
  const [verifying, setVerifying] = useState(false);    // red/incierto tras confirm → reconciliar, NO fail ciego
  const [terminal, setTerminal] = useState(false);      // confirm falló definitivo → order 'failed' → modal claro
  const orderRef = useRef({ key: null });
  const slowTimer = useRef(null);

  const startConfirming = () => { setConfirming(true); setConfirmSlow(false); setErr(null); slowTimer.current = setTimeout(() => setConfirmSlow(true), 6000); };
  const stopConfirming = () => { setConfirming(false); setConfirmSlow(false); if (slowTimer.current) clearTimeout(slowTimer.current); };
  useEffect(() => () => { if (slowTimer.current) clearTimeout(slowTimer.current); }, []);

  const buildConfig = (method) => ({
    payment_method: method, team_name: name.trim(), team_color: design.colors[0], team_design: design.id,
    team_secret: secret.trim(), credit_applied: creditApplied, reward_applied: rewardApplied,
  });

  const finish = async () => {
    const key = orderRef.current.key;
    if (!key) return;
    // confirm_championship_team_registration es IDEMPOTENTE: si la order ya está 'confirmed' devuelve el equipo
    // (already:true). Clasificamos el fallo por su NATURALEZA:
    //   · error de RPC (res.error) = confirm EJECUTÓ y lanzó → rollback total → NADA materializó, order sigue 'pending'.
    //   · excepción (red/timeout) = INCIERTO → no sabemos si confirmó → reconciliamos reintentando (idempotente).
    let res;
    try {
      res = await confirmChampionshipTeamRegistration({ championshipId, idempotencyKey: key });
    } catch {
      // RED/INCIERTO: 1 reintento de reconciliación (idempotente). Si ya confirmó, lo devuelve; si sigue incierto,
      // NO hacemos fail ciego (pudo haber confirmado) → "Estamos verificando tu pago" con reintento manual.
      try { res = await confirmChampionshipTeamRegistration({ championshipId, idempotencyKey: key }); }
      catch { stopConfirming(); setVerifying(true); return; }
    }
    const { data, error } = res;
    if (!error) {
      // Éxito (incluye already:true de la reconciliación). Confirmación SOBRE Profile + highlight; enlace solo-navegación.
      orderRef.current = { key: null };
      stopConfirming(); setVerifying(false);
      const teamId = data?.team_id || null;
      const link = teamId ? `${window.location.origin}/championships/view/${championshipId}?team=${teamId}` : `${window.location.origin}/championships/view/${championshipId}`;
      navigate('/profile', { replace: true, state: { champConfirm: 'team_created', championshipId, champShareLink: link, champTeamName: name.trim() } });
      return;
    }
    // ERROR DE RPC = confirm no materializó (rollback) → order 'pending'. La TERMINALIZAMOS con la MISMA key →
    // fail_championship_team_registration la pasa a 'failed' → el trigger de núcleo restaura el crédito gastado en
    // create. Solo tras quedar terminal liberamos la key (permite un nuevo intento SIN doble débito).
    setVerifying(false);
    await failChampionshipTeamRegistration({ championshipId, idempotencyKey: key, reason: 'confirm_failed' }).catch(() => {});
    orderRef.current = { key: null };
    stopConfirming();
    setTerminal(true);
  };

  // Pasarela (external>0): crea order al pulsar Pagar.
  const gatewayPreCharge = async () => {
    const o = orderRef.current; if (!o.key) o.key = uuidv4();
    const { error } = await createChampionshipTeamRegistrationOrder({ championshipId, idempotencyKey: o.key, config: buildConfig('gateway') });
    if (error) {
      if (/ALREADY_ENROLLED|AVAILABILITY_CHANGED|NOT_OPEN/.test(error.message || '')) { orderRef.current = { key: null }; return { error: 'AVAILABILITY_CHANGED' }; }
      return { error: error.message || 'NETWORK' };
    }
    return { championshipId };
  };
  const gatewayPaid = async () => { setPayOpen(false); startConfirming(); await finish(); };
  const gatewayRejected = async () => {
    if (orderRef.current.key) await failChampionshipTeamRegistration({ championshipId, idempotencyKey: orderRef.current.key, reason: 'payment_rejected' });
    orderRef.current = { key: null };
  };
  const availabilityBack = () => { setPayOpen(false); back(); };

  // external=0 (100% crédito/reward): sin pasarela → crear order + confirmar directo.
  const payWithCredit = async () => {
    if (confirming) return; startConfirming();
    const o = orderRef.current; if (!o.key) o.key = uuidv4();
    const { error } = await createChampionshipTeamRegistrationOrder({ championshipId, idempotencyKey: o.key, config: buildConfig('credit') });
    if (error) { stopConfirming(); setErr(regErrorMessage(error.message)); if (/ALREADY_ENROLLED|AVAILABILITY_CHANGED/.test(error.message || '')) orderRef.current = { key: null }; return; }
    await finish();
  };

  const canSubmit = nameOk && secretOk && unitPrice > 0 && !confirming;

  // Teclado móvil: con el teclado abierto el navegador panea el layout viewport (100dvh) y se ve el fondo azul de
  // #root, moviendo toda la pantalla. Fijamos el alto de ESTA screen-shell al alto VISIBLE (visualViewport.height)
  // SOLO mientras el teclado está abierto → no hace falta panear, el input queda alcanzable por el scroller interno
  // (overflowY:auto, overscrollBehavior:none) y el fondo no se mueve. Sin teclado, se restaura (layout intacto).
  const shellRef = useRef(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const prevBodyOv = document.body.style.overflow;
    const apply = () => {
      const shell = shellRef.current; if (!shell) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);   // alto aproximado del teclado
      if (kb > 120) { shell.style.height = vv.height + 'px'; document.body.style.overflow = 'hidden'; }
      else { shell.style.height = ''; document.body.style.overflow = prevBodyOv; }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      const shell = shellRef.current; if (shell) shell.style.height = '';
      document.body.style.overflow = prevBodyOv;
    };
  }, []);

  return (
    <div ref={shellRef} className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', position: 'relative' }}>
      <TopBar title="Crear equipo" onCancel={back} />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'none' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: TEXT, letterSpacing: -0.6, lineHeight: 1.1 }}>{championshipName}</div>
          <div style={{ marginTop: 6, fontSize: 13.5, color: SUB }}>Inscripción de equipo · {soles(unitPrice)}</div>
        </div>

        {/* Previsualización del escudo */}
        <div style={{ padding: '20px 16px 0', display: 'flex', justifyContent: 'center' }}>
          <Shield color={design.colors[0]} design={design} name={name} size={120} />
        </div>

        {/* Diseño del escudo */}
        <div style={{ padding: '18px 16px 0' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 8 }}>Diseño del escudo</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {TEAM_DESIGNS.map(d => (
              <button key={d.id} onClick={() => setDesign(d)} className="pressable" aria-label={`Diseño ${d.id}`}
                style={{ padding: 3, borderRadius: 10, border: `2px solid ${d.id === design.id ? ORANGE : 'transparent'}`, background: 'transparent', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <DesignSwatch design={d} size={32} />
              </button>
            ))}
          </div>
        </div>

        {/* Nombre */}
        <div style={{ padding: '18px 16px 0' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 6 }}>Nombre del equipo</div>
          <input value={name} onChange={e => { if (withinTeamNameWordLimit(e.target.value)) setName(e.target.value); }} placeholder="Nombre del equipo" maxLength={40}
            style={{ width: '100%', height: 44, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Clave del equipo */}
        <div style={{ padding: '18px 16px 0' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 6 }}>Clave del equipo</div>
          <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="Mínimo 4 caracteres" maxLength={40}
            style={{ width: '100%', height: 44, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ marginTop: 6, fontSize: 12, color: SUB }}>Los jugadores la necesitarán para unirse (o usa el link que podrás compartir después).</div>
        </div>
        <div style={{ height: 8 }} />
      </div>

      <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        {/* Recompensas: toggle opcional (solo payer, tope unit). */}
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

        {/* Resumen (una unidad = inscripción de equipo) */}
        <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
            <span>Inscripción de equipo</span>
            <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(unitPrice)}</span>
          </div>
          {rewardApplied > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: '#6D5AE6' }}>
              <span>Recompensas</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>−{soles(rewardApplied)}</span>
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
        <CtaButton onPress={noExternal ? payWithCredit : () => { setErr(null); setPayOpen(true); }} disabled={!canSubmit}>
          {confirming ? 'Procesando...' : `Crear equipo · ${soles(externalAmount)}`}
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

      {confirming && (
        <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,15,0.88)', padding: '0 32px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.2)', borderTop: '4px solid #fff', animation: 'spin 0.9s linear infinite', marginBottom: 28 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3 }}>
            {confirmSlow ? 'Está tardando más de lo habitual' : 'Estamos creando tu equipo...'}
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            {confirmSlow ? 'Estamos verificando el estado de tu pago.' : 'No cierres esta pantalla.'}
          </div>
        </div>
      )}

      {/* RED/INCIERTO tras confirm: NO afirmamos nada (pudo haber confirmado). Veil con reintento de reconciliación
          (vuelve a llamar confirm, idempotente). No se resetea la key → no hay doble order. */}
      {verifying && (
        <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,15,0.88)', padding: '0 32px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.2)', borderTop: '4px solid #fff', animation: 'spin 0.9s linear infinite', marginBottom: 28 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3 }}>Estamos verificando tu pago</div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.4 }}>No cierres esta pantalla. Si no avanza, reintenta la verificación.</div>
          <button onClick={() => { setVerifying(false); startConfirming(); finish(); }} className="pressable" style={{ marginTop: 24, height: 48, padding: '0 22px', borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Reintentar verificación</button>
        </div>
      )}

      {/* TERMINAL: confirm falló definitivo y la order quedó 'failed' (crédito restaurado por el trigger). Modal claro
          en vez de checkout desnudo. "No se realizó ningún cobro" SOLO si fue 100% crédito (sin importe externo). */}
      {terminal && (
        <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: '0 24px' }}>
          <div className="sheet-panel" style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 24, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#FDECEC', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#E5484D" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>No pudimos crear el equipo</div>
            <div style={{ fontSize: 14.5, color: SUB, lineHeight: 1.5, marginTop: 10 }}>La operación no se completó.{noExternal ? ' No se realizó ningún cobro.' : ''}</div>
            <button onClick={() => { setTerminal(false); back(); }} className="pressable" style={{ marginTop: 24, width: '100%', height: 50, borderRadius: 14, border: 'none', background: BLUE, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Entendido</button>
          </div>
        </div>
      )}

    </div>
  );
}
