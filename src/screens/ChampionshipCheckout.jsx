import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TEXT, SUB, HAIR, ORANGE, BLUE, GREEN } from '../constants';
import { CtaButton, TopBar } from '../components/checkout/CheckoutUI';
import PaymentSheet from '../components/checkout/PaymentSheet';
import { CHAMPIONSHIP_BASE_PRICE, CHAMPIONSHIP_EXTRAS, CHAMPIONSHIP_BANK, championshipTotal, soles, makeRegistrationKey, computeRegistrationClose, CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS } from '../data/championshipCheckoutMock';

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

export default function ChampionshipCheckout() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = location.state || {};
  const summary = nav.summary || {};
  const organizeState = nav.organizeState || null;
  const championshipName = nav.championshipName || summary.name || 'Copa AlGrass';

  // Pago CONFIRMADO (electrónico) → el campeonato existe como 'pending_publish' (NO se publica solo).
  // Crea el campeonato con el `status` inicial según el método de pago y navega a Profile con la confirmación.
  //  - Electrónico (tarjeta/Yape/pasarela): pago confirmado → 'pending_publish' (puede publicar).
  //  - Transferencia: voucher enviado → 'payment_validation' ("Validando pago"); AlGrass valida antes de publicar.
  const createChampionship = (status, champConfirm) => {
    setPayOpen(false);
    const cv = readCV() || {};
    cv.championship = {
      status,
      privacy: 'private',
      createdByUserId: 'you', // owner = quien pagó (mock 'you'); futuro: currentUser.id de Supabase
      registrationKey: makeRegistrationKey(championshipName),
      registrationClosesAt: computeRegistrationClose(organizeState?.dateKey),
      publishedAt: null,
    };
    writeCV(cv);
    // Navegar YA a Profile; la confirmación aparece SOBRE Profile (replace → Back no vuelve al checkout).
    navigate('/profile', { replace: true, state: { champConfirm } });
  };
  const confirmPayment = () => createChampionship('pending_publish', 'created');            // electrónico
  const confirmTransferPayment = () => createChampionship('payment_validation', 'created_validation'); // transferencia

  const base = CHAMPIONSHIP_BASE_PRICE;
  const [selected, setSelected] = useState(() => new Set());   // ids de extras
  const [receipt, setReceipt] = useState('boleta');            // 'boleta' | 'factura'
  const [ruc, setRuc] = useState('');
  const [razon, setRazon] = useState('');
  const [direccion, setDireccion] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  const total = championshipTotal(base, selected);
  const selectedExtras = CHAMPIONSHIP_EXTRAS.filter(e => selected.has(e.id));
  const toggleExtra = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Validación frontend básica de Factura (independiente del método de pago).
  const rucValid = /^\d{11}$/.test(ruc);
  const facturaOk = receipt === 'boleta' || (rucValid && razon.trim().length > 0 && direccion.trim().length > 0);

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
          <SummaryRow label="Precio base" value={soles(base)} />
        </div>

        {/* ── Agregar extras (mismo patrón/interacción que Agregar jugadores) ── */}
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${HAIR}` }}>
          <div style={sectionTitle}>Agregar extras</div>
          <div style={{ marginTop: 4 }}>
            {CHAMPIONSHIP_EXTRAS.map((e, i) => {
              const on = selected.has(e.id);
              return (
                <button key={e.id} onClick={() => toggleExtra(e.id)} style={{
                  width: '100%', textAlign: 'left', padding: '11px 0', background: 'transparent', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, borderTop: i === 0 ? 'none' : `1px solid ${HAIR}`, WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit',
                }}>
                  <span style={{ width: 42, height: 42, borderRadius: '50%', background: '#F2F2F4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, flexShrink: 0 }}>{e.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: TEXT }}>{e.label}</div>
                    <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>+ {soles(e.price)}</div>
                  </div>
                  <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, border: `1.6px solid ${on ? ORANGE : '#C7C7CC'}`, background: on ? ORANGE : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

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

      {/* ── Footer sticky: desglose + Total + Pagar (mismo patrón que ConfirmReservation) ── */}
      <div className="cr-footer-ios-test" style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))' }}>
        <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
            <span>Campeonato</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(base)}</span>
          </div>
          {selectedExtras.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, color: SUB }}>
              <span>{e.label}</span><span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(e.price)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 8, borderTop: `1px solid ${HAIR}`, marginTop: 4, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>
            <span>Total</span><span style={{ whiteSpace: 'nowrap' }}>{soles(total)}</span>
          </div>
        </div>

        <CtaButton onPress={() => setPayOpen(true)} disabled={!facturaOk}>
          Confirmar
        </CtaButton>
      </div>

      {/* Pasarela reutilizada de Partidos + método Transferencia (solo Campeonato). MOCK. */}
      {payOpen && (
        <PaymentSheet
          amount={total}
          currency="S/"
          onClose={() => setPayOpen(false)}
          onPaid={confirmPayment}                 // electrónico → campeonato 'pending_publish'
          transfer={{ bank: CHAMPIONSHIP_BANK, onConfirm: confirmTransferPayment }} // transferencia → 'payment_validation'
        />
      )}
    </div>
  );
}
