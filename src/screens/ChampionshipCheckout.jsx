import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE, BLUE, GREEN } from '../constants';
import { CtaButton, TopBar } from '../components/checkout/CheckoutUI';
import PaymentSheet from '../components/checkout/PaymentSheet';
import { CHAMPIONSHIP_BANK, soles, computeRegistrationClose } from '../data/championshipCheckoutMock';
import { uuidv4 } from '../lib/uuid';
import { useAuth } from '../context/AuthContext';
import { uploadChampionshipProof } from '../utils/championshipProof';
import { supabase } from '../lib/supabase';
import { createTransferHold, confirmTransfer as confirmTransferRpc, releaseTransferHold, quoteChampionship, getChampionshipConfig, createGatewayOrder, confirmGatewayPayment, failGateway } from '../services/championshipService';

// Emoji del círculo por code de extra (la config no envía emoji). Fallback genérico.
const EXTRA_EMOJI = { trophy: '🏆', medals: '🥇', photography: '📷', filming: '🎥' };
// Errores backend → mensaje controlado para la UX.
function champErrorMessage(msg) {
  const m = String(msg || '');
  if (/CHAMPIONSHIP_AVAILABILITY_BLOCKED/.test(m)) return 'Ese horario ya no está disponible. Elige otro.'; // §10: sin mencionar Admin
  if (/AVAILABILITY_CHANGED/.test(m)) return 'La disponibilidad cambió. Vuelve a consultar los horarios.';
  if (/BOOKING_LEAD_NOT_MET/.test(m)) return 'La fecha elegida no cumple la anticipación mínima.';
  if (/CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE/.test(m)) return 'Configuración de anticipación no disponible.';
  if (/CHAMPIONSHIP_FORMAT_UNAVAILABLE/.test(m)) return 'El formato seleccionado no está disponible.';
  if (/CHAMPIONSHIP_CONFIG_UNAVAILABLE/.test(m)) return 'La configuración de esta ciudad no está disponible.';
  if (/EXTRA_QUANTITY_OUT_OF_RANGE/.test(m)) return 'Cantidad de un extra fuera de rango.';
  if (/EXTRA_NOT_AVAILABLE/.test(m)) return 'Uno de los extras ya no está disponible.';
  if (/DUPLICATE_EXTRA/.test(m)) return 'Extra repetido en la selección.';
  return 'No pudimos calcular el precio. Inténtalo de nuevo.';
}

// Mismo session-state que ChampionshipView (mock, sin Supabase).
const CV_KEY = 'championship_view_state';
function readCV() { try { return JSON.parse(sessionStorage.getItem(CV_KEY)); } catch { return null; } }
function writeCV(o) { try { sessionStorage.setItem(CV_KEY, JSON.stringify(o)); } catch {} }

// Mismo lenguaje que ConfirmReservation: cuerpo blanco con secciones separadas por hairline,
// filas de "agregar" idénticas a agregar jugadores, footer sticky con desglose + Total + CTA.
const inputStyle = { width: '100%', height: 44, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' };
const sectionTitle = { fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 };

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderTop: `1px solid ${HAIR}`, alignItems: 'baseline' }}>
      <div style={{ flexShrink: 0, fontSize: 13, color: SUB }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</div>
    </div>
  );
}

// Puestos: 1=oro, 2=plata, 3=bronce. Iconos (no emojis) ~21px. Se muestran SOLO tantos como quantity.
const MEDAL_COLORS = ['#E3B341', '#AEB2BD', '#C6803C']; // oro, plata, bronce
function TrophyMini({ color, size = 21 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 4h10v3.5a5 5 0 0 1-10 0V4Z" fill={color} />
      <path d="M7 5.4H4.6V6a2.5 2.5 0 0 0 2.5 2.5M17 5.4h2.4V6A2.5 2.5 0 0 1 16.9 8.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12.4V15" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 19.2c0-1.4 1.3-2.3 3.5-2.3s3.5.9 3.5 2.3Z" fill={color} />
    </svg>
  );
}
function MedalMini({ color, size = 21 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 3l2.6 6M15 3l-2.6 6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="15" r="5.2" fill={color} />
      <circle cx="12" cy="15" r="2.1" fill="#fff" fillOpacity="0.5" />
    </svg>
  );
}
// Iconos dinámicos de puestos: exactamente `qty` iconos (oro→plata→bronce), sin grises ni huecos.
function PodiumIcons({ kind, qty }) {
  const Icon = kind === 'trophy' ? TrophyMini : MedalMini;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} aria-hidden="true">
      {Array.from({ length: qty }, (_, i) => <Icon key={i} color={MEDAL_COLORS[i]} />)}
    </div>
  );
}

export default function ChampionshipCheckout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const nav = location.state || {};
  const summary = nav.summary || {};
  const organizeState = nav.organizeState || null;
  const championshipName = nav.championshipName || summary.name || 'Copa AlGrass';
  // Color de portada elegido en "Ver mi campeonato" (default rojo = COVER_THEMES[0]). Se PERSISTE al crear
  // (p_config.cover_theme) para que el listado/Profile respeten el mismo color aunque el owner no edite portada.
  const coverTheme = nav.coverTheme || '#E24A4A';

  // Pago CONFIRMADO (electrónico) → el campeonato existe como 'pending_publish' (NO se publica solo).
  // Crea el campeonato con el `status` inicial según el método de pago y navega a Profile con la confirmación.
  //  - Electrónico (tarjeta/Yape/pasarela): pago confirmado → 'pending_publish' (puede publicar).
  //  - Transferencia: voucher enviado → 'payment_validation' ("Validando pago"); AlGrass valida antes de publicar.
  const createChampionship = (status, champConfirm, extra = {}) => {
    setPayOpen(false);
    const cv = readCV() || {};
    cv.championship = {
      status,
      privacy: 'private',
      createdByUserId: 'you', // owner = quien pagó (mock 'you'); futuro: currentUser.id de Supabase
      registrationKey: null,  // NUNCA clave ficticia: la crea el owner en "Tu campeonato" (update_championship_privacy)
      registrationClosesAt: computeRegistrationClose(organizeState?.dateKey),
      publishedAt: null,
      realId: extra.realId ?? null,   // id REAL en Supabase (transfer). null = flujo mock (electrónico).
    };
    writeCV(cv);
    // Navegar YA a Profile; la confirmación aparece SOBRE Profile (replace → Back no vuelve al checkout).
    navigate('/profile', { replace: true, state: { champConfirm } });
  };
  const confirmPayment = () => createChampionship('pending_publish', 'created');            // electrónico (mock)

  const [receipt, setReceipt] = useState('boleta');            // 'boleta' | 'factura'
  const [ruc, setRuc] = useState('');
  const [razon, setRazon] = useState('');
  const [direccion, setDireccion] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  // Ciudad (autoridad de config) + formato: derivados del flujo real (venue/grupo elegidos). El backend
  // igual re-deriva ciudad de los games; aquí city solo sirve para PINTAR el catálogo de extras.
  const city = summary.city || organizeState?.city || null;
  const groupId = organizeState?.groupId || null;
  // games.id REALES seleccionados en el grid. Fuente ÚNICA del hold/quote. [] en el flujo "personalizar".
  const selectedGameIds = summary.selectedGameIds || organizeState?.selectedGameIds || [];

  // ── Config REAL por ciudad (catálogo de extras + precios unitarios para PINTAR). NO es autoridad. ──
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    if (!city) { setCfg(null); return; }
    let alive = true;
    getChampionshipConfig({ city }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { console.warn('[championship config]', error.message); setCfg(null); return; }
      setCfg(data);
    });
    return () => { alive = false; };
  }, [city]);
  const catalog = cfg?.extras || [];   // [{code,name,unit_price,units_per_item,min_quantity,max_quantity,sort_order}]

  // Cantidad por extra (0..max_quantity). Toggle (min==max==1) → 0/1. Fuente de verdad de la selección.
  const [qty, setQty] = useState({});                          // { [code]: n }
  const getQty = (code) => qty[code] ?? 0;
  const setQtyFor = (code, next, max) => setQty(q => ({ ...q, [code]: Math.min(max, Math.max(0, next)) }));
  // Payload para quote/hold: SOLO qty>0, únicamente {code, quantity} (nunca precio).
  const extrasPayload = catalog.filter(e => getQty(e.code) > 0).map(e => ({ code: e.code, quantity: getQty(e.code) }));
  const extrasKey = JSON.stringify(extrasPayload);

  // ── QUOTE REAL = autoridad del precio (court/referee/fee/extras/total). Async con guard de carrera. ──
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const quoteReqRef = useRef(0);
  const gameIdsKey = selectedGameIds.join(',');
  useEffect(() => {
    // Flujo "personalizar" / sin selección real / sin formato → no se cotiza (no hay canchas que reservar).
    if (!selectedGameIds.length || !groupId) { setQuote(null); setQuoteError(null); setQuoteLoading(false); return; }
    const reqId = ++quoteReqRef.current;
    setQuoteLoading(true); setQuoteError(null);
    quoteChampionship({ gameIds: selectedGameIds, groupId, extras: extrasPayload }).then(({ data, error }) => {
      if (reqId !== quoteReqRef.current) return;   // respuesta vieja → NO sobrescribe una cotización más nueva
      setQuoteLoading(false);
      if (error) { setQuote(null); setQuoteError(champErrorMessage(error.message)); return; }
      setQuote(data);
    }).catch((e) => {
      if (reqId !== quoteReqRef.current) return;
      setQuoteLoading(false); setQuote(null); setQuoteError(champErrorMessage(e?.message));
    });
  }, [gameIdsKey, groupId, extrasKey]); // eslint-disable-line

  const total = quote?.amount_total != null ? Number(quote.amount_total) : null;
  const hasValidQuote = !!quote && !quoteLoading && !quoteError && total != null;

  // Stepper EXACTO de Partidos (ConfirmReservation.stepBtn): círculo, borde BLUE.
  const stepBtn = (onClick, disabled, plus) => (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 28, height: 28, borderRadius: '50%', border: `1.6px solid ${disabled ? '#D6D6DC' : BLUE}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: disabled ? 0.5 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d={plus ? 'M8 4v8M4 8h8' : 'M4 8h8'} stroke={disabled ? '#9A9AA0' : BLUE} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );

  // Validación frontend básica de Factura (independiente del método de pago).
  const rucValid = /^\d{11}$/.test(ruc);
  const facturaOk = receipt === 'boleta' || (rucValid && razon.trim().length > 0 && direccion.trim().length > 0);

  // ── Hold de Transferencia REAL (Supabase) ────────────────────────────────────────────────────
  const champHoldRef = useRef({ id: null, key: null, gameIds: [], voucherPath: null, voucherFile: null });
  const resetAttempt = () => { champHoldRef.current = { id: null, key: null, gameIds: [], voucherPath: null, voucherFile: null }; };

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const eventDate = DATE_RE.test(organizeState?.dateKey || '') ? organizeState.dateKey : null;

  // p_config del hold: group_id + extras[{code,quantity}] son lo autoritativo que consume el backend;
  // el resto es metadata visual para championship.format_config. NO se envía precio/city/venue/fecha como autoridad.
  const buildHoldConfig = () => ({
    name: championshipName,
    cover_theme: coverTheme,   // color de portada real elegido → se guarda en championships.cover_theme
    privacy: 'private',
    registration_key: null,   // materialización SIN clave: NULL en DB. El owner la define después (Fase 5).
    results_public: true,
    group_id: groupId,                 // AUTORIDAD del formato (backend resuelve service_court_hours/lead)
    extras: extrasPayload,             // [{code, quantity}] — sin precio
    format_config: {
      summary, organizeState,
      formatLabel: summary.formatLabel, group: summary.group,
      venueName: summary.venueName, slotLabel: summary.slotLabel, configLabel: summary.configLabel,
    },
  });

  // onReserve: crea el hold REAL con los games.id EXACTOS que el usuario eligió en el grid real.
  // Idempotente (§7/§10): reusa key+gameIds en reintentos → no duplica. Sin selección real → no crea hold.
  const reserveChampionshipHold = async () => {
    const h = champHoldRef.current;
    if (!h.key) h.key = uuidv4();
    if (!h.gameIds.length) {
      if (!selectedGameIds.length) return { error: 'AVAILABILITY_CHANGED' }; // §8/§10: sin IDs reales → volver a disponibilidad
      h.gameIds = selectedGameIds;
    }
    // Validación explícita ANTES de la RPC (§4): fecha real válida. Sin defaults arbitrarios.
    if (!eventDate) return { error: 'INVALID_DATE' };
    if (!groupId) return { error: 'CHAMPIONSHIP_FORMAT_UNAVAILABLE' };   // sin formato → el backend no puede tarifar
    const config = buildHoldConfig();
    const { data, error } = await createTransferHold({ gameIds: h.gameIds, idempotencyKey: h.key, config });
    if (error) {
      // AVAILABILITY_CHANGED o bloqueo vigente de Championship (carrera: Admin bloqueó tras abrir la pantalla).
      // En ambos el reintento con la misma key NO puede resolverlo → volver a disponibilidad a re-consultar. §7/§10.
      if (/AVAILABILITY_CHANGED|CHAMPIONSHIP_AVAILABILITY_BLOCKED/.test(error.message || '')) { resetAttempt(); return { error: 'AVAILABILITY_CHANGED' }; }
      return { error: error.message || 'NETWORK' };  // reintentable con la MISMA key (idempotencia backend)
    }
    h.id = data.id;
    return { holdExpiresAt: data.hold_expires_at };
  };

  // onRelease: liberación voluntaria (X / Salir / cambiar método). Si falla NO limpiamos (§13): el sheet
  // mantiene el estado y reintenta; el cron es fallback.
  const releaseChampionshipHold = async () => {
    const id = champHoldRef.current.id;
    if (!id) { resetAttempt(); return {}; }
    const { error } = await releaseTransferHold({ championshipId: id });
    if (error) return { error: error.message || 'NETWORK' };
    resetAttempt();
    return {};
  };

  // onConfirm(proofFile): sube el comprobante REAL al bucket privado y confirma la transferencia.
  //   Orden: hold ya existe (id real) → upload {user}/{champId}/{uuid}.ext → confirm con p_voucher_ref=path.
  //   Éxito → order=validation, championship=payment_validation + payment_voucher_ref=path. Games reserved.
  // Idempotencia/retry: NO se crea segundo championship/order (se reusa champHoldRef.id). Si el upload ya
  //   subió este mismo File, se reutiliza su path (no re-sube). Comprobante OBLIGATORIO: sin archivo o
  //   con upload fallido NO se confirma (el usuario reintenta con el hold vigente).
  const confirmChampionshipTransfer = async (proofFile) => {
    const h = champHoldRef.current;
    if (!h.id) return { error: 'NO_HOLD' };
    if (!proofFile) return { error: 'NO_PROOF' };
    if (!user?.id) return { error: 'AUTH_REQUIRED' };

    // 1) Upload (reutiliza path si es el MISMO File ya subido en un intento previo → evita huérfanos en retry).
    let path = (h.voucherPath && h.voucherFile === proofFile) ? h.voucherPath : null;
    if (!path) {
      const up = await uploadChampionshipProof(supabase, { userId: user.id, championshipId: h.id, file: proofFile });
      if (up.error) return { error: up.error };   // no confirmar sin comprobante subido
      path = up.path;
      h.voucherPath = path; h.voucherFile = proofFile;
    }

    // 2) Confirmar con el storage path real (se guarda en championships.payment_voucher_ref).
    const { data, error } = await confirmTransferRpc({ championshipId: h.id, voucherRef: path });
    if (error) {
      if (/HOLD_EXPIRED/.test(error.message || '')) { resetAttempt(); return { error: 'HOLD_EXPIRED' }; }
      return { error: error.message || 'NETWORK' };   // reintentable: upload ya hecho, se reusa el path
    }
    resetAttempt();
    createChampionship('payment_validation', 'created_validation', { realId: data.id });
    return {};
  };

  // onExpire: el contador llegó a 0. El frontend NO toca games (autoridad = backend/cron). Solo
  // invalida el intento (key/id/gameIds) → la próxima "Reservar" es un intento nuevo con key nueva. §14.
  const expireChampionshipHold = () => { resetAttempt(); };

  // AVAILABILITY_CHANGED: cerrar sheet, limpiar intento y volver a Crear campeonato a re-consultar disponibilidad. §9.
  const availabilityChangedBack = () => {
    resetAttempt();
    setPayOpen(false);
    navigate('/championships/organize', organizeState ? { state: { organizeState } } : undefined);
  };

  // ── PASARELA (Gateway) REAL: acquire lógico EN "PAGAR" → mock cobro → confirm/fail ───────────────
  // El acquire ocurre en onPreCharge (justo al pulsar Pagar, ANTES del mock del cobro), NO al seleccionar.
  // Idempotente por intento (key estable). No usa create_order normal ni duplica orders.
  const gatewayRef = useRef({ id: null, key: null });
  const resetGateway = () => { gatewayRef.current = { id: null, key: null }; };

  // onPreCharge(method): adquiere el pending lógico Gateway. Si pierde la carrera (AVAILABILITY_CHANGED /
  // NO_CAPACITY) → devuelve ese error y el sheet muestra "La disponibilidad cambió" (sin iniciar el mock).
  const gatewayPreCharge = async (method) => {
    const g = gatewayRef.current;
    if (!g.key) g.key = uuidv4();
    if (!selectedGameIds.length) return { error: 'AVAILABILITY_CHANGED' };  // sin IDs reales → volver a disponibilidad
    if (!eventDate) return { error: 'INVALID_DATE' };
    if (!groupId) return { error: 'CHAMPIONSHIP_FORMAT_UNAVAILABLE' };       // sin formato → backend no puede tarifar
    const config = { ...buildHoldConfig(), payment_method: method || 'gateway' };
    const { data, error } = await createGatewayOrder({ gameIds: selectedGameIds, idempotencyKey: g.key, config });
    if (error) {
      if (/AVAILABILITY_CHANGED|NO_CAPACITY|CHAMPIONSHIP_AVAILABILITY_BLOCKED/.test(error.message || '')) { resetGateway(); return { error: 'AVAILABILITY_CHANGED' }; }
      return { error: error.message || 'NETWORK' };   // reintentable con la MISMA key (idempotencia backend)
    }
    g.id = data.id;
    return { championshipId: data.id };
  };

  // onPaid: el mock aprobó → confirmar el pago (materializa reserved + championship_id + 1 spend). Solo
  // aquí los games pasan a reserved. Éxito → campeonato 'pending_publish' (mismo destino/UX que hoy).
  const gatewayPaid = async (/* method, proof */) => {
    const id = gatewayRef.current.id;
    if (!id) return;
    const { error } = await confirmGatewayPayment({ championshipId: id });
    if (error) {
      // Carrera al confirmar (algún game se tomó) o expiró → volver a disponibilidad a re-consultar.
      resetGateway();
      availabilityChangedBack();
      return;
    }
    resetGateway();
    createChampionship('pending_publish', 'created', { realId: id });
  };

  // onRejected: el mock rechazó el cobro → cancelar el pending (games siguen published, sin spend/refund).
  const gatewayRejected = async () => {
    const id = gatewayRef.current.id;
    if (id) { await failGateway({ championshipId: id, reason: 'payment_rejected' }); }
    resetGateway();
  };

  const back = () => navigate(-1);

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <TopBar title="Pagar campeonato" onCancel={back} />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

        {/* ── Resumen ── */}
        <div style={{ padding: '10px 16px 14px' }}>
          <div style={sectionTitle}>Resumen</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.3, margin: '8px 0 4px' }}>{championshipName}</div>
          <SummaryRow label="Formato" value={`${summary.formatLabel || '7v7'}${summary.group ? ` · ${summary.group.min}–${summary.group.max} equipos` : ''}`} />
          <SummaryRow label="Fecha" value={summary.dateLabel} />
          <SummaryRow label="Sede" value={summary.venueName} />
          <SummaryRow label="Horario" value={summary.slotLabel} />
          <SummaryRow label="Canchas" value={summary.configLabel} />
        </div>

        {/* ── Agregar extras (catálogo REAL de config; active=true, ordenados por sort_order) ── */}
        {catalog.length > 0 && (
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${HAIR}` }}>
          <div style={sectionTitle}>Agregar extras</div>
          <div style={{ marginTop: 4 }}>
            {catalog.map((e, i) => {
              const q = getQty(e.code);
              const withQty = e.max_quantity > 1;                                       // stepper (0..max)
              const on = q > 0;                                                          // toggle (min==max==1) usa 0/1
              const label = e.units_per_item > 1 ? `${e.name} (${e.units_per_item})` : e.name;
              const rowStyle = {
                width: '100%', textAlign: 'left', padding: '11px 0', background: 'transparent',
                display: 'flex', alignItems: 'center', gap: 12, borderTop: i === 0 ? 'none' : `1px solid ${HAIR}`,
                WebkitTapHighlightColor: 'transparent', outline: 'none',
              };
              const emojiCircle = <span style={{ width: 42, height: 42, borderRadius: '50%', background: '#F2F2F4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, flexShrink: 0 }}>{EXTRA_EMOJI[e.code] || '🎟️'}</span>;
              const nameBlock = (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT }}>{label}</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>+ {soles(e.unit_price)}</div>
                </div>
              );
              // max>1 → contador min..max (con iconos de puesto para trophy/medals). NO se hardcodean límites.
              if (withQty) {
                const podium = e.code === 'trophy' ? 'trophy' : e.code === 'medals' ? 'medal' : null;
                return (
                  <div key={e.code} style={rowStyle}>
                    {emojiCircle}
                    {nameBlock}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {podium && <PodiumIcons kind={podium} qty={q} />}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {stepBtn(() => setQtyFor(e.code, q - 1, e.max_quantity), q <= 0, false)}
                        <span style={{ minWidth: 26, textAlign: 'center', fontSize: 19, fontWeight: 800, color: TEXT }}>{q}</span>
                        {stepBtn(() => setQtyFor(e.code, q + 1, e.max_quantity), q >= e.max_quantity, true)}
                      </div>
                    </div>
                  </div>
                );
              }
              // min==max==1 → toggle simple (checkbox), quantity 0/1.
              return (
                <div key={e.code} onClick={() => setQtyFor(e.code, on ? 0 : 1, e.max_quantity)} className="pressable" role="button" tabIndex={0} style={{ ...rowStyle, cursor: 'pointer' }}>
                  {emojiCircle}
                  {nameBlock}
                  <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, border: `1.6px solid ${on ? ORANGE : '#C7C7CC'}`, background: on ? ORANGE : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ── Comprobante (antes de Pagar; método de pago va recién en la pasarela) ── */}
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${HAIR}` }}>
          <div style={sectionTitle}>Comprobante</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {['boleta', 'factura'].map(r => (
              <button key={r} onClick={() => setReceipt(r)} className="pressable" style={{
                flex: 1, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13.5, fontWeight: 700, textTransform: 'capitalize',
                background: receipt === r ? BLUE : '#fff', color: receipt === r ? '#fff' : TEXT,
                boxShadow: receipt === r ? 'none' : `inset 0 0 0 1px ${HAIR}`, WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>{r}</button>
            ))}
          </div>
          {/* Espacio reservado bajo el selector SOLO en Boleta (para que al pasar a Factura el RUC
              quede a la vista sin mover la pantalla). En Factura, el RUC empieza con separación normal. */}
          <div style={{ height: receipt === 'factura' ? 12 : 40 }} />
          {receipt === 'factura' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={ruc} onChange={e => setRuc(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="RUC (11 dígitos)" inputMode="numeric" style={{ ...inputStyle, borderColor: ruc && !rucValid ? '#F3C0C0' : HAIR }} />
              <input value={razon} onChange={e => setRazon(e.target.value)} placeholder="Razón social" style={inputStyle} />
              <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Dirección fiscal" style={inputStyle} />
              {ruc && !rucValid && <div style={{ fontSize: 12, color: '#C0392B' }}>El RUC debe tener 11 dígitos.</div>}
            </div>
          )}
        </div>

        <div style={{ height: 8 }} />
      </div>

      {/* ── Footer sticky: desglose REAL (quote) + Total + Confirmar ── */}
      <div className="cr-footer-ios-test" style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quote ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
                <span>Canchas</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(quote.court_amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
                <span>Árbitros</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(quote.referee_amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
                <span>Organización AlGrass</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(quote.algrass_fee_amount)}</span>
              </div>
              {(quote.extras || []).map(x => (
                <div key={x.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
                  <span>{x.name}{x.quantity > 1 ? ` ×${x.quantity}` : ''}</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(x.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 8, borderTop: `1px solid ${HAIR}`, marginTop: 4, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>
                <span>Total</span><span style={{ whiteSpace: 'nowrap' }}>{soles(quote.amount_total)}</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB, minHeight: 20, alignItems: 'center' }}>
              <span>{quoteError ? quoteError : quoteLoading ? 'Calculando precio…' : 'Selecciona un horario para ver el precio'}</span>
              {quoteLoading && <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2.5px solid rgba(0,0,0,0.15)', borderTop: `2.5px solid ${BLUE}`, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
            </div>
          )}
        </div>

        <CtaButton onPress={() => setPayOpen(true)} disabled={!facturaOk || !hasValidQuote}>
          {quoteLoading ? 'Calculando…' : 'Confirmar'}
        </CtaButton>
      </div>

      {/* Pasarela reutilizada de Partidos + método Transferencia (solo Campeonato). MOCK. */}
      {payOpen && (
        <PaymentSheet
          amount={total ?? 0}
          currency="S/"
          onClose={() => setPayOpen(false)}
          onPreCharge={gatewayPreCharge}          // Gateway: acquire lógico ANTES del mock del cobro
          onPaid={gatewayPaid}                    // mock aprobó → confirm_championship_gateway_payment
          onRejected={gatewayRejected}            // mock rechazó → fail_championship_gateway
          onAvailabilityChanged={availabilityChangedBack}  // acquire perdió la carrera → volver a disponibilidad
          transfer={{
            bank: CHAMPIONSHIP_BANK,
            onReserve: reserveChampionshipHold,             // create_championship_transfer_hold (hold REAL)
            onRelease: releaseChampionshipHold,             // release_championship_transfer_hold
            onConfirm: confirmChampionshipTransfer,         // confirm_championship_transfer → 'payment_validation'
            onExpire: expireChampionshipHold,               // contador 0 → invalida intento (cron libera)
            onAvailabilityChanged: availabilityChangedBack, // §9
          }}
        />
      )}
    </div>
  );
}
