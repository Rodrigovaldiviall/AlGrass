// PaymentSheet (pasarela/modal) COMPARTIDO por Partidos (ConfirmReservation) y Campeonatos
// (ChampionshipCheckout). Movido VERBATIM desde ConfirmReservation; misma UX y flujo de pago.
// Único añadido, opt-in por prop `transfer`: método "Transferencia bancaria". Sin `transfer`
// el sheet es EXACTAMENTE el de Partidos (Yape / Tarjeta / Apple-Google Pay). No cambia el
// comportamiento real de pago de Partidos.
import { useState, useEffect, useRef } from 'react';
import { useSheetPull } from '../../hooks/useSheetPull';
import { TEXT, SUB, HAIR, ORANGE, YAPE, DANGER, BLUE, GREEN } from '../../constants';
import { activateIosScrim, deactivateIosScrim } from '../../lib/iosScrim';
import { charge } from '../../services/paymentAdapter';
import { validateProofFile, PROOF_TYPES } from '../../utils/championshipProof';
import aprobarComprasYape from '../../assets/Aprobar compras yape.webp';
import codigoYape from '../../assets/Código yape.webp';
import { CtaButton, MethodRow } from './CheckoutUI';

// Valor con opción de copiar: al tocar copia al portapapeles y muestra "Copiado" brevemente.
function CopyValue({ text, children, style }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    try { navigator.clipboard?.writeText(String(text)); } catch { /* no-op */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button onClick={doCopy} className="pressable" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none', ...style }}>
      {copied ? <span style={{ color: GREEN, fontWeight: 700 }}>Copiado</span> : children}
      {!copied && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect x="9" y="9" width="11" height="11" rx="2" stroke={BLUE} strokeWidth="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function BankRow({ label, value, copyable = false, masked = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '3px 0' }}>
      <span style={{ fontSize: 12.5, color: SUB }}>{label}</span>
      {masked
        // Bloqueado hasta reservar: puntos discretos (no blur, no números reales, no "cargando").
        ? <span style={{ fontSize: 12.5, fontWeight: 700, color: '#C2C2CC', letterSpacing: 2, textAlign: 'right' }}>••••••••••••</span>
        : copyable
          ? <CopyValue text={value} style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, letterSpacing: 0.2 }}><span>{value}</span></CopyValue>
          : <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, textAlign: 'right', letterSpacing: 0.2 }}>{value}</span>}
    </div>
  );
}

export default function PaymentSheet({ amount, currency = 'S/.', label, onClose, onPreCharge, onPaid, onRejected, onAvailabilityChanged, transfer = null }) {
  // Campeonato (transfer): Transferencia seleccionada/expandida por default. Partidos: Yape (sin cambios).
  const [activeTab, setActiveTab] = useState(transfer ? 'transfer' : 'yape');
  const [open, setOpen] = useState(false);
  const [cardNum, setCardNum] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [yapePhone, setYapePhone] = useState('');
  const [yapeCode, setYapeCode] = useState('');
  const [paying, setPaying]     = useState('idle');
  const [transferProof, setTransferProof] = useState(null); // File real seleccionado (solo Campeonato)
  const [proofError, setProofError] = useState('');         // error de tipo/tamaño del comprobante
  const transferFileRef = useRef(null);

  // ── HOLD de Transferencia (SOLO Campeonato): hold REAL de 10 min creado por Supabase.
  //    Se modela con un instante de expiración (holdExpiresAt) que viene del BACKEND (hold_expires_at),
  //    NO un contador local reiniciable ni Date.now()+10min. El tick local solo pinta MM:SS; la
  //    autoridad de expiración es el backend/cron. Las mutaciones (crear/liberar/confirmar) las
  //    ejecuta el padre vía transfer.onReserve / onRelease / onConfirm (RPC reales). Ver §4/§11/§16.
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);  // ms | null (null = aún no reservado)
  const [nowMs, setNowMs] = useState(() => Date.now());      // reloj para el contador (tick 1s)
  const [exitConfirm, setExitConfirm] = useState(null);      // { kind:'close'|'switch', method? } | null
  const [reserving, setReserving] = useState(false);         // create_championship_transfer_hold en curso
  const [releasing, setReleasing] = useState(false);         // release_… en curso (salir / cambiar método)
  const [confirmingTransfer, setConfirmingTransfer] = useState(false); // confirm_… en curso
  const [availabilityChanged, setAvailabilityChanged] = useState(false); // overlay "La disponibilidad cambió"
  const [actionError, setActionError] = useState(null);      // error controlado (reserve/release/confirm) sin cerrar
  const expiredNotifiedRef = useRef(false);                  // onExpire una sola vez por hold
  const holdRemaining   = holdExpiresAt != null ? holdExpiresAt - nowMs : 0;
  const transferReserved = holdExpiresAt != null && holdRemaining > 0;  // hold vigente → UX actual + contador
  const transferExpired  = holdExpiresAt != null && holdRemaining <= 0; // llegó a 00:00 → volver a reservar
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // Campeonato (prop `transfer`): incluye Transferencia (primera y default) y el método activo expande
  // hacia ARRIBA. El holder crece de forma NATURAL (maxHeight 92%) para intentar mostrar TODAS las
  // opciones sin scroll; el scroll interno queda solo como fallback en pantallas pequeñas. Sin anclaje.
  const anchorEnabled = !!transfer;
  // Cambia de método realmente (scroll + activeTab). Se llama directo o tras confirmar "Cambiar de método".
  const applyMethod = (method) => {
    if (anchorEnabled && method === 'yape' && scrollRef.current) scrollRef.current.scrollTop = 0;
    setActiveTab(method);
  };
  const selectMethod = (method) => {
    if (method === activeTab) return;
    // Con un hold de transferencia VIGENTE, cambiar de método NO libera en silencio: pide confirmación
    // (la reserva temporal se cancelaría). Ver §15. Si no hay hold vigente, cambia normal.
    if (activeTab === 'transfer' && method !== 'transfer' && transferReserved) {
      setExitConfirm({ kind: 'switch', method });
      return;
    }
    applyMethod(method);
  };
  // Tarjeta (Campeonato): inputs y separación algo mayores para distribuir mejor dentro de la altura común
  // (moderados para NO provocar overflow → Tarjeta cabe sin scroll).
  const cih = anchorEnabled ? 52 : 48;
  const cmb = anchorEnabled ? 14 : 10;

  // Scrim de safe-area inferior SOLO durante "Estamos confirmando tu reserva…" (overlay
  // rgba(10,10,15,0.88), instantáneo). NO en idle/loading/rejected (PaymentSheet = body BLANCO).
  // #27272C/0s = gris equivalente a 0.88 sobre blanco, sin fade.
  useEffect(() => {
    if (paying === 'confirming') activateIosScrim('gateway-processing', { color: '#27272C', duration: '0s' });
    else deactivateIosScrim('gateway-processing');
    return () => deactivateIosScrim('gateway-processing');
  }, [paying]);

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const nativeLabel = isIOS ? 'Apple Pay' : 'Google Pay';
  const fmt = n => `${currency} ${Number(n || 0).toFixed(2)}`;
  const amtStr = label ?? fmt(amount);

  const isTransfer = activeTab === 'transfer';
  const yapeValid = yapePhone.length === 9 && yapeCode.length === 6;
  const cardValid = cardNum.replace(/\s/g, '').length === 16 && cardExp.length === 5 && cardCvc.length === 3 && cardPhone.length === 9;
  const canPay = isTransfer
    ? !!transferProof
    : (activeTab === 'native' || (activeTab === 'yape' && yapeValid) || (activeTab === 'card' && cardValid));

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

  function doClose() {
    setPaying('idle');
    setOpen(false);
    setTimeout(() => onClose?.(), 240);
  }
  function handleClose() {
    if (paying === 'loading' || paying === 'confirming') return;
    if (reserving || releasing || confirmingTransfer) return; // RPC en curso: no cerrar a medias
    if (exitConfirm) return; // ya hay una confirmación abierta
    // Con hold de transferencia VIGENTE, cerrar NO es inmediato: confirmar (la reserva se cancelaría). §11.
    if (transferReserved) { setExitConfirm({ kind: 'close' }); return; }
    doClose();
  }
  // Modal de salida/cambio con hold activo: continuar (no toca nada) vs confirmar (libera REAL + cierra/cambia).
  function exitStay() { if (releasing) return; setActionError(null); setExitConfirm(null); } // "Seguir con el pago"
  // Confirmar salida/cambio: libera el hold REAL (RPC) ANTES de cerrar/cambiar. Si la liberación FALLA
  // (red/backend), NO cerramos: el backend puede seguir manteniendo el hold → mantener modal y reintentar. §13.
  async function exitConfirmYes() {
    if (releasing) return;
    const ec = exitConfirm;
    setActionError(null);
    setReleasing(true);
    try {
      const res = await transfer?.onRelease?.();
      if (res?.error) {
        setReleasing(false);
        setActionError('No pudimos cancelar tu reserva. Revisa tu conexión e inténtalo de nuevo.');
        return; // mantiene exitConfirm abierto para reintentar; NO libera estado local
      }
      // Éxito real: las canchas fueron liberadas por el backend → limpiar estado local del hold.
      setHoldExpiresAt(null);
      setTransferProof(null);
      setReleasing(false);
      setExitConfirm(null);
      if (ec?.kind === 'switch') applyMethod(ec.method);
      else doClose();
    } catch (e) {
      console.error('[exitConfirmYes] release threw:', e);
      setReleasing(false);
      setActionError('No pudimos cancelar tu reserva. Revisa tu conexión e inténtalo de nuevo.');
    }
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
      // Gateway Championship: la carrera en la ADQUISICIÓN (create_championship_gateway_order) devuelve
      // 'AVAILABILITY_CHANGED' → mostramos aquí el overlay in-sheet (no arrancamos el mock, conservamos config).
      if (pre.error === 'AVAILABILITY_CHANGED') {
        setPaying('idle');
        setAvailabilityChanged(true);
        return;
      }
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

  // "Reservar y realizar transferencia": crea el HOLD REAL (create_championship_transfer_hold vía el padre).
  // Revalida disponibilidad de TODAS las canchas server-side; el contador arranca con hold_expires_at REAL.
  // Idempotente: el padre reusa la misma key en reintentos (§7/§10) → no crea dos campeonatos.
  async function reserveTransfer() {
    if (reserving || transferReserved) return;
    setActionError(null);
    setReserving(true);
    try {
      const res = await transfer?.onReserve?.();
      if (res?.error === 'AVAILABILITY_CHANGED') { setReserving(false); setAvailabilityChanged(true); return; } // §9
      if (res?.error) { setReserving(false); setActionError('No pudimos crear tu reserva. Revisa tu conexión e inténtalo de nuevo.'); return; } // §10: reintentable con la misma key
      if (res?.holdExpiresAt != null) {
        expiredNotifiedRef.current = false;
        setTransferProof(null);
        const exp = new Date(res.holdExpiresAt).getTime();
        setNowMs(Date.now());
        setHoldExpiresAt(exp);   // instante REAL del backend (NO Date.now()+10min). §6
      }
    } catch (e) {
      console.error('[reserveTransfer] onReserve threw:', e);
      setActionError('No pudimos crear tu reserva. Revisa tu conexión e inténtalo de nuevo.');
    }
    setReserving(false);
  }

  // "Ya realicé la transferencia": confirma REAL (confirm_championship_transfer vía el padre):
  // order pending→validation, championship transfer_hold→payment_validation. Los games SIGUEN reserved.
  // En éxito el padre navega a Profile ("Validando pago"); aquí solo cerramos. Si el backend responde
  // HOLD_EXPIRED (el cron ganó la carrera), reflejamos estado expirado sin liberar nada localmente. §16.
  async function confirmTransfer() {
    if (!transferProof || confirmingTransfer) return;
    if (holdExpiresAt == null || Date.now() >= holdExpiresAt) { setNowMs(Date.now()); return; }
    setActionError(null);
    setConfirmingTransfer(true);
    try {
      const res = await transfer?.onConfirm?.(transferProof);
      if (res?.error === 'HOLD_EXPIRED') {
        setConfirmingTransfer(false);
        setHoldExpiresAt(Date.now() - 1);        // forzar UI expirada; el backend/cron ya liberó las canchas
        transfer?.onExpire?.();                  // el padre invalida la key/id → próxima reserva = intento nuevo
        return;
      }
      if (res?.error) { setConfirmingTransfer(false); setActionError('No pudimos confirmar tu transferencia. Inténtalo de nuevo.'); return; }
      setOpen(false);                            // éxito: el padre navega; el sheet se desmonta
    } catch (e) {
      console.error('[confirmTransfer] onConfirm threw:', e);
      setConfirmingTransfer(false);
      setActionError('No pudimos confirmar tu transferencia. Inténtalo de nuevo.');
    }
  }

  // Contador del hold: tick cada 1s mientras haya un holdExpiresAt (re-render no reinicia el plazo,
  // porque holdExpiresAt es estado persistente y el visible = holdExpiresAt − now).
  useEffect(() => {
    if (holdExpiresAt == null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  // Expiración local (contador → 00:00): el frontend NO toca games (autoridad = backend/cron). Solo
  // notifica al padre UNA vez para invalidar la key/id (próxima reserva = intento nuevo) y bloquea la CTA. §14.
  useEffect(() => {
    if (transferExpired && !expiredNotifiedRef.current) {
      expiredNotifiedRef.current = true;
      setTransferProof(null);
      transfer?.onExpire?.();
    }
  }, [transferExpired]); // eslint-disable-line

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
  const bankIcon = (
    <svg width="22" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 9l9-5 9 5" stroke={TEXT} strokeWidth="1.6" strokeLinejoin="round"/><path d="M5 9v8m5-8v8m4-8v8m5-8v8M3 19h18" stroke={TEXT} strokeWidth="1.6" strokeLinecap="round"/>
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
        // Altura COMÚN FIJA para Transferencia/Yape/Tarjeta (Campeonato): la ventana no cambia entre ellos;
        // Transferencia/Tarjeta caben SIN scroll y Yape desborda hacia abajo. Apple Pay usa altura natural.
        height: (anchorEnabled && activeTab !== 'native') ? 'min(92vh, 720px)' : undefined,
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
          {/* Cabecera fija arriba (Método de pago + Total). El resto (desde Transferencia) baja en bloque.
              El precio crece dentro del paddingBottom (reducido a la par) → no desplaza nada arriba ni abajo. */}
          <div style={{ paddingBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>Método de pago</div>
            <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: SUB }}>Total a pagar</span>
              <strong style={{ fontSize: 16, fontWeight: 800, color: ORANGE, letterSpacing: -0.2 }}>{amtStr}</strong>
            </div>
          </div>

          {/* Transferencia bancaria — SOLO Campeonato (prop `transfer`). Primera opción y default. */}
          {transfer && (
          <div style={{ position: 'relative' }}>
            {/* Contador FUERA del marco azul de Transferencia, encima a la derecha, en el hueco superior.
                Absolute → no ocupa alto ni expande la ventana. */}
            {transferReserved && (
              <span style={{ position: 'absolute', top: -20, right: 28, fontSize: 16, fontWeight: 800, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums', color: holdRemaining < 120000 ? DANGER : TEXT }}>{mmss(holdRemaining)}</span>
            )}
            <MethodRow
              active={isTransfer}
              onSelect={() => selectMethod('transfer')}
              reverseExpand
              accentColor={BLUE}
              icon={bankIcon}
              label="Transferencia bancaria"
            >
              <div>
                {/* Recuadro bancario — MISMO tamaño siempre. Banco/Titular/RUC reales. Las filas Cuenta/CCI
                    ocupan SIEMPRE su alto (reales, ocultas por visibility antes del hold); en ese MISMO espacio
                    se superpone el mensaje. Al reservar → mensaje fuera, Cuenta/CCI reales visibles. Cero reflow. */}
                <div style={{ marginTop: 14, borderRadius: 12, background: '#F6F8FF', border: `1px solid ${HAIR}`, padding: '9px 14px' }}>
                  <BankRow label="Banco" value={transfer.bank.bankName} />
                  <BankRow label="Titular" value={transfer.bank.accountHolder} />
                  <BankRow label="RUC" value={transfer.bank.ruc} />
                  <div style={{ position: 'relative' }}>
                    <div style={{ visibility: transferReserved ? 'visible' : 'hidden' }} aria-hidden={!transferReserved}>
                      <BankRow label="Cuenta" value={transfer.bank.accountNumber} copyable />
                      <BankRow label="CCI" value={transfer.bank.cci} copyable />
                    </div>
                    {!transferReserved && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: 12.5, color: transferExpired ? DANGER : SUB, lineHeight: 1.35 }}>
                          {transferExpired
                            ? 'El tiempo de reserva terminó. Vuelve a reservar para comprobar que las canchas siguen disponibles.'
                            : 'Reservaremos tu campeonato durante 10 minutos para que realices la transferencia y adjuntes el comprobante.'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {transferReserved ? (
                  /* Hold vigente → adjuntar comprobante (confirmar = footer). */
                  <>
                    <input ref={transferFileRef} type="file" accept={PROOF_TYPES.join(',')} style={{ display: 'none' }} onChange={e => {
                      const f = e.target.files?.[0] || null;
                      const err = f ? validateProofFile(f) : '';
                      if (err) { setProofError(err); setTransferProof(null); }   // rechazo frontend: no se sube
                      else { setProofError(''); setTransferProof(f); }
                      if (transferFileRef.current) transferFileRef.current.value = ''; // permite re-seleccionar el mismo archivo
                    }} />
                    <button onClick={() => transferFileRef.current?.click()} className="pressable" style={{ marginTop: 8, width: '100%', height: 44, borderRadius: 12, border: `1.5px dashed ${BLUE}`, background: '#fff', color: BLUE, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {transferProof ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
                    </button>
                    {transferProof && (
                      <div style={{ marginTop: 6, fontSize: 12.5, color: SUB, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: GREEN }}>✓</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{transferProof.name}</span>
                      </div>
                    )}
                    {proofError && <div style={{ marginTop: 6, fontSize: 12.5, color: DANGER, lineHeight: 1.35 }}>{proofError}</div>}
                    <div style={{ marginTop: 6, fontSize: 11.5, color: SUB }}>JPG, PNG, WEBP o PDF · hasta 10 MB.</div>
                  </>
                ) : (
                  /* Estado PREVIO: la CTA usa el MISMO espacio que "Adjuntar comprobante" (misma altura/margen). */
                  <>
                    <button onClick={reserveTransfer} disabled={reserving} className="pressable" style={{ marginTop: 8, width: '100%', height: 44, borderRadius: 12, border: 'none', background: BLUE, color: '#fff', cursor: reserving ? 'default' : 'pointer', opacity: reserving ? 0.75 : 1, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      {reserving
                        ? <><span style={{ width: 15, height: 15, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)', borderTop: '2.5px solid #fff', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Reservando...</>
                        : 'Reservar y realizar transferencia'}
                    </button>
                    {actionError && !transferExpired && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: DANGER, lineHeight: 1.35 }}>{actionError}</div>
                    )}
                  </>
                )}
              </div>
            </MethodRow>
          </div>
          )}

          {/* Yape */}
          <MethodRow
            active={activeTab === 'yape'}
            onSelect={() => selectMethod('yape')}
            reverseExpand={anchorEnabled}
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
            onSelect={() => selectMethod('card')}
            accentColor={ORANGE}
            icon={cardIcon}
            label="Paga con Tarjeta"
            reverseExpand
          >
            <div style={{ marginTop: anchorEnabled ? 10 : 8 }}>
              <input
                value={cardNum}
                onChange={e => setCardNum(formatCard(e.target.value))}
                placeholder="Número de tarjeta"
                inputMode="numeric"
                style={{ width: '100%', height: cih, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box', marginBottom: cmb }}
              />
              <div style={{ display: 'flex', gap: 10, marginBottom: cmb }}>
                <input value={cardExp} onChange={e => setCardExp(formatExp(e.target.value))} placeholder="MM/AA" inputMode="numeric"
                  style={{ flex: 1, minWidth: 0, height: cih, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box' }} />
                <input value={cardCvc} onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="CVC" inputMode="numeric"
                  style={{ width: 80, flexShrink: 0, height: cih, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', fontSize: 15, fontFamily: 'inherit', color: TEXT, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', borderRadius: 12, border: `1.5px solid ${HAIR}`, background: '#fff', overflow: 'hidden' }}>
                <span style={{ padding: '0 10px 0 14px', fontSize: 13, color: SUB, fontWeight: 600, whiteSpace: 'nowrap', height: cih, display: 'flex', alignItems: 'center', borderRight: `1px solid ${HAIR}` }}>🇵🇪 +51</span>
                <input value={cardPhone} onChange={e => setCardPhone(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="Teléfono (9 dígitos)" inputMode="numeric"
                  style={{ flex: 1, height: cih, padding: '0 12px', background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: TEXT }} />
              </div>
            </div>
          </MethodRow>

          {/* 3. Apple Pay / Google Pay */}
          <div className="hide-on-desktop">
            <MethodRow
              active={activeTab === 'native'}
              onSelect={() => selectMethod('native')}
              accentColor="#1B1B1F"
              icon={nativeIcon}
              label={nativeLabel}
            />
          </div>

          <div style={{ height: 2 }} />
        </div>

        {/* Sticky footer — Pagar (pasarela) o "Ya realicé la transferencia" (mock). */}
        <div className="cr-footer-ios-test" style={{ padding: '12px 16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', borderTop: `1px solid ${HAIR}`, background: '#FAFAFA', flexShrink: 0 }}>
          {isTransfer ? (
            /* CTA inferior general: SIEMPRE "Ya realicé la transferencia" (nunca "Reservar…", que es interno).
               Deshabilitado antes del hold y durante el hold sin comprobante; se habilita con hold vigente + proof. */
            <CtaButton onPress={confirmTransfer} disabled={!transferReserved || !transferProof || confirmingTransfer}>
              {confirmingTransfer
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Confirmando...</span>
                : `Ya realicé la transferencia de ${amtStr}`}
            </CtaButton>
          ) : (
            <CtaButton onPress={pay} disabled={!canPay || paying !== 'idle'}>
              {paying === 'loading' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  Procesando...
                </span>
              ) : `Pagar ${amtStr}`}
            </CtaButton>
          )}
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

      {/* AVAILABILITY_CHANGED (§9): el hold NO se creó (una o más canchas dejaron de estar libres). No hay
          contador ni championship activo. CTA → el padre cierra el sheet, limpia el intento y vuelve a Crear campeonato. */}
      {availabilityChanged && (
        <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 212, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: '0 32px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FFF3E0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="16.5" r="1.2" fill={ORANGE} />
              <circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="1.8" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.4, textAlign: 'center' }}>La disponibilidad cambió</div>
          <div style={{ marginTop: 8, fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
            Durante el proceso, puede ser que una o más canchas seleccionadas fueran reservadas. Vuelve a consultar la disponibilidad.
          </div>
          <div style={{ marginTop: 28, width: '100%', maxWidth: 320 }}>
            <CtaButton onPress={() => { setOpen(false); setTimeout(() => (transfer?.onAvailabilityChanged ?? onAvailabilityChanged)?.(), 220); }}>
              Volver a crear campeonato
            </CtaButton>
          </div>
        </div>
      )}

      {/* Confirmación de salida/cambio con hold de transferencia VIGENTE (§11/§12). Fuera del hold no aparece.
          Confirmar libera el hold REAL (RPC); si falla NO cierra (§13) → muestra error y permite reintentar. */}
      {exitConfirm && (
        <div className="sheet-overlay" onClick={exitStay} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{exitConfirm.kind === 'switch' ? '¿Cambiar de método de pago?' : '¿Seguro que quieres salir?'}</div>
            <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>{exitConfirm.kind === 'switch' ? 'Tu reserva temporal será cancelada si cambias de método de pago.' : 'Tu reserva temporal será cancelada y las canchas volverán a estar disponibles.'}</div>
            {actionError && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: DANGER, lineHeight: 1.4 }}>{actionError}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              <button onClick={exitStay} disabled={releasing} className="pressable" style={{ width: '100%', height: 48, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: releasing ? 'default' : 'pointer', opacity: releasing ? 0.6 : 1, fontFamily: 'inherit', fontSize: 15, fontWeight: 800, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{exitConfirm.kind === 'switch' ? 'Seguir con Transferencia' : 'Seguir con el pago'}</button>
              <button onClick={exitConfirmYes} disabled={releasing} className="pressable" style={{ width: '100%', height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: DANGER, cursor: releasing ? 'default' : 'pointer', opacity: releasing ? 0.7 : 1, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {releasing
                  ? <><span style={{ width: 15, height: 15, borderRadius: '50%', border: '2.5px solid rgba(220,38,38,0.25)', borderTop: `2.5px solid ${DANGER}`, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Cancelando...</>
                  : (exitConfirm.kind === 'switch' ? 'Cambiar de método' : 'Salir y cancelar reserva')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
