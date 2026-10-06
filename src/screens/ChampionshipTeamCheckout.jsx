import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE } from '../constants';
import { CtaButton, TopBar } from '../components/checkout/CheckoutUI';
import PaymentSheet from '../components/checkout/PaymentSheet';
import ConfirmedOverlay from '../components/ConfirmedOverlay';
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

  const back = () => navigate(championshipId ? `/championships/view/${championshipId}` : '/championships');
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
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);   // { teamId, joinToken } → overlay de éxito
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
    // confirm → team_id + join_token (autoridad backend). Overlay de éxito con el link.
    const { data, error } = await confirmChampionshipTeamRegistration({ championshipId, idempotencyKey: orderRef.current.key });
    if (error) {
      stopConfirming();
      const m = error.message || '';
      if (/AVAILABILITY_CHANGED|NOT_OPEN|ALREADY_ENROLLED|ORDER_EXPIRED|REWARD_/.test(m)) orderRef.current = { key: null };
      setErr(regErrorMessage(m));
      return;
    }
    orderRef.current = { key: null };
    stopConfirming();
    setDone({ teamId: data?.team_id || null, joinToken: data?.join_token || null });
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
  const shareLink = done?.joinToken ? `${window.location.origin}/championships/view/${championshipId}?jt=${done.joinToken}` : '';

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', position: 'relative' }}>
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

      {done && (
        <ConfirmedOverlay
          title="¡Equipo creado!"
          lines={[name.trim(), 'Comparte el enlace para que tus jugadores se unan.']}
          shareLink={shareLink}
          onOK={() => navigate(`/championships/view/${championshipId}`, { replace: true })}
        />
      )}
    </div>
  );
}
