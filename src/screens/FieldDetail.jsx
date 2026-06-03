import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, DANGER, WHATSAPP_NUMBER } from '../constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faCommentSms } from '@fortawesome/free-solid-svg-icons';
import I from '../icons';
import { FIELDS } from '../data/fields';
import { GAME_DEFAULTS } from '../data/games';
import TabBar from '../components/TabBar';
import RatingBlock from '../components/RatingBlock';
import { supabase } from '../lib/supabase';
import { getVenueCoverUrl } from '../utils/venue';

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDateEs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${_DOW[d.getDay()]} ${d.getDate()} ${_MON[d.getMonth()]} ${d.getFullYear()}`;
}

function parsePriceSoles(str) {
  const n = parseFloat((str || '').replace(/[^\d.]/g, '').replace(/^\./, ''));
  return isNaN(n) ? 0 : n;
}

const FIELD_DESCRIPTION = [
  'Cancha profesional con iluminación LED y césped sintético de alta calidad.',
  'Contamos con vestuarios, duchas y estacionamiento disponible.',
  'El horario reservado incluye balón y petos. El organizador estará presente para ayudar.',
];

const FIELD_RECOMMENDATIONS = [
  'Por favor llegar 10 minutos antes del inicio.',
  'Llevar ropa deportiva y taloneras recomendadas.',
];

function buildField(sel) {
  if (!sel) return null;
  const priceNumber = parsePriceSoles(sel.price);
  const chips = [
    { kind: 'format',  label: sel.format  || '7v7' },
    sel.filmed && { kind: 'filmed', label: 'Filmado' },
  ].filter(Boolean);
  return {
    id:          sel.id,
    field:       sel.field,
    address:     sel.address || '',
    date:        sel.date || formatDateEs(sel.dateKey),
    time:        `${sel.time} ${sel.ampm}`,
    duration:    GAME_DEFAULTS.duration,
    chips,
    description: FIELD_DESCRIPTION,
    recommendations: FIELD_RECOMMENDATIONS,
    price:            sel.price,
    priceNumber,
    currency:         'S/.',
    format:           sel.format || '7v7',
    image:            sel.image ?? null,
    venueCoverPath:    sel.venueCoverPath    ?? null,
    venueCoverVersion: sel.venueCoverVersion ?? null,
    source:           'campo',
    organizer:        GAME_DEFAULTS.organizer,
    paymentBreakdown: sel.paymentBreakdown ?? null,
    paidBy:           sel.paidBy           ?? null,
    paidByCode:       sel.paidByCode       ?? null,
  };
}

// ── Header
function Header({ field, onBack, onShare }) {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          {I.back('#fff')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{field}</div>
        </div>
        <button
          onClick={onShare}
          style={{ width: 36, height: 36, marginRight: -6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
          {I.share('#fff')}
        </button>
      </div>
    </div>
  );
}

// ── Hero image
function HeroImage({ coverPath, coverVersion }) {
  const src = coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null;
  if (src) {
    return (
      <div style={{ width: '100%', aspectRatio: '16/6.3', overflow: 'hidden', flexShrink: 0 }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', aspectRatio: '16/6.3', background: SOFT,
      backgroundImage: 'repeating-linear-gradient(135deg, #E8E8EC 0 14px, #F2F2F4 14px 28px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: SUB, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12, letterSpacing: 0.4,
    }}>FOTO DEL CAMPO</div>
  );
}

// ── Info row
function InfoRow({ icon, primary, secondary, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{primary}</div>
        {secondary && <div style={{ fontSize: 13, color: SUB, marginTop: 2, lineHeight: 1.35 }}>{secondary}</div>}
      </div>
      {action}
    </div>
  );
}

function WAChatButton() {
  const [open, setOpen] = useState(false);
  const ph = WHATSAPP_NUMBER;
  const displayPhone = `+${ph.slice(0, 2)} ${ph.slice(2, 5)} ${ph.slice(5, 8)} ${ph.slice(8)}`;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none', padding: '2px 0' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: SUB }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 11, color: SUB, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>
          Comunícate con<br />el organizador
        </span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 100, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: `1px solid ${HAIR}`, overflow: 'hidden', minWidth: 252 }}>
            <a href={`https://wa.me/${ph}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none', borderBottom: `1px solid ${HAIR}` }}>
              <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 22, color: '#25D366', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPhone}</div>
              </div>
            </a>
            <a href={`sms:+${ph}`} onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
              <FontAwesomeIcon icon={faCommentSms} style={{ fontSize: 22, color: BLUE, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>SMS</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ── Avatar
function Avatar({ name, size = 36 }) {
  const initials = (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const hue = [...(name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 45% 35%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size >= 44 ? 14 : 12, fontWeight: 700, flexShrink: 0,
    }}>{initials || '·'}</div>
  );
}

// ── Chip
const CHIP_ICON = { format: I.twoPeople, filmed: I.camera };
function Chip({ kind, label }) {
  const icon = CHIP_ICON[kind];
  return (
    <div style={{ flex: '0 0 auto', height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, color: TEXT, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {icon ? icon(TEXT) : null}
      <span>{label}</span>
    </div>
  );
}

// ── Section
function Section({ title, children }) {
  return (
    <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.1, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function PaymentDetail({ price, breakdown, paidBy }) {
  const [open, setOpen] = useState(false);
  if (!price || price === 'S/. 0.00') return null;
  const fmt = n => `S/. ${Number(n || 0).toFixed(2)}`;
  const row = (label, value, bold, accent) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: bold ? 700 : 500, color: accent ? GREEN : TEXT }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
  const bdHasNewFmt = breakdown && (breakdown.promoDiscount != null || breakdown.creditApplied != null);
  const bdPromoDisc = breakdown?.promoDiscount ?? 0;
  const bdCreditApp = breakdown?.creditApplied ?? (bdHasNewFmt ? 0 : (breakdown?.discount ?? 0));
  return (
    <div style={{ margin: '12px 16px 12px', borderRadius: 14, border: `1px solid ${HAIR}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', height: 46, padding: '0 14px', background: '#FAFAFA', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Ver detalles del pago</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M4 6l4 4 4-4" stroke={SUB} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{ padding: '12px 14px 14px', borderTop: `1px solid ${HAIR}`, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paidBy ? (
            row('Monto pagado', price, true)
          ) : breakdown ? (
            <>
              {row('Titular', fmt(breakdown.unitPrice))}
              {bdPromoDisc > 0 && row('Descuento', `−${fmt(bdPromoDisc)}`, false, true)}
              {breakdown.guestsCount > 0 && row(`Invitados (${breakdown.guestsCount})`, fmt(breakdown.guestsTotal))}
              {bdCreditApp > 0 && row('Crédito aplicado', `−${fmt(bdCreditApp)}`, false, true)}
              <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 8 }}>
                {row('Total', fmt(breakdown.total), true)}
              </div>
            </>
          ) : (
            row('Total', price, true)
          )}
        </div>
      )}
    </div>
  );
}

// ── CTA
function CTA({ price, onPress }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div style={{ padding: '12px 16px 12px', background: '#fff', borderTop: `1px solid ${HAIR}` }}>
      <button
        onClick={onPress}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        style={{
          width: '100%', height: 54, borderRadius: 18,
          background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer',
          fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)',
          transform: pressed ? 'scale(0.985)' : 'scale(1)',
          transition: 'transform .12s ease, box-shadow .15s ease',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
        {I.joinIcon('#1B1B1F')}
        <span>Reservar cancha por {price}</span>
      </button>
    </div>
  );
}

const CREDIT_KEY_FD = 'pichanga_credit';

// ── CancelSheetField
function CancelSheetField({ fieldId, price, onClose, onDone }) {
  const [open, setOpen]           = useState(false);
  const [step, setStep]           = useState('idle');
  const [capturedRefund, setCapturedRefund] = useState(0);

  const refundAmount = parseFloat((price || '').replace(/[^\d.]/g, '').replace(/^\./, '')) || 0;
  const fmt = n => `S/. ${Number(n).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function dismiss() {
    if (step === 'processing') return;
    setOpen(false);
    setTimeout(onClose, 220);
  }

  function confirm() {
    setCapturedRefund(refundAmount);
    setStep('processing');
    setTimeout(() => {
      if (refundAmount > 0) {
        try {
          const credit = JSON.parse(localStorage.getItem(CREDIT_KEY_FD) || '{"balance":0,"transactions":[]}');
          credit.balance = (credit.balance || 0) + refundAmount;
          credit.transactions = [
            { id: 'tx-' + Date.now(), amount: refundAmount, reason: 'Cancelación de reserva de campo', createdAt: new Date().toISOString() },
            ...(credit.transactions || []),
          ];
          localStorage.setItem(CREDIT_KEY_FD, JSON.stringify(credit));
        } catch {}
      }
      try {
        const res = JSON.parse(localStorage.getItem('pichanga_reservations') || '[]');
        localStorage.setItem('pichanga_reservations', JSON.stringify(res.filter(r => r.id !== fieldId)));
      } catch {}
      setStep('done');
      setTimeout(() => onDone(), 1600);
    }, 1800);
  }

  return (
    <div className="sheet-overlay" onClick={step !== 'processing' ? dismiss : undefined} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>

        {step === 'idle' && (
          <div style={{ padding: '20px 16px calc(20px + env(safe-area-inset-bottom))' }}>
            <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 8, letterSpacing: -0.2 }}>Cancelar reserva</div>
            {refundAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${HAIR}` }}>
                <span style={{ fontSize: 14, color: SUB }}>Total a reembolsar</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{fmt(refundAmount)}</span>
              </div>
            )}
            <button onClick={confirm} style={{ width: '100%', height: 50, borderRadius: 14, background: DANGER, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              Confirmar cancelación
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div style={{ padding: '48px 24px calc(48px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: `4px solid ${SOFT}`, borderTop: `4px solid ${BLUE}`, animation: 'spin 0.9s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Procesando...</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '40px 24px calc(40px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>Cancelación procesada</div>
            {capturedRefund > 0 && (
              <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
                Se generó un crédito de <strong style={{ color: GREEN }}>{fmt(capturedRefund)}</strong> en tu perfil.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen
export default function FieldDetail() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { id }    = useParams();

  const [cancelOpen, setCancelOpen] = useState(false);
  const isPastGame = location.state?.isPast   ?? false;
  const rating     = location.state?.rating   ?? null;
  const backPath   = location.state?.backPath  ?? '/fields';

  const sel = location.state?.field ?? FIELDS.find(f => f.id === id) ?? null;
  const g   = useMemo(() => buildField(sel), [sel]);

  const isBooked = useMemo(() => {
    const fid = sel?.id ?? id ?? null;
    if (!fid) return false;
    try {
      const res = JSON.parse(localStorage.getItem('pichanga_reservations')) || [];
      return res.some(r => r.id === fid && r.type === 'campo');
    } catch { return false; }
  }, [sel?.id, id]);

  const infoMode = (location.state?.infoMode ?? false) || isBooked;

  if (!g) {
    return (
      <div className="screen-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, fontSize: 15 }}>
        Cancha no encontrada
      </div>
    );
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <Header field={g.field} onBack={() => navigate(backPath)}
        onShare={() => navigator.share?.({ title: g.field, text: g.address, url: window.location.href }).catch(() => {})} />
      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
        <HeroImage coverPath={g.venueCoverPath} coverVersion={g.venueCoverVersion} />

        {isBooked && (
          <div style={{ padding: '7px 16px 0', display: 'flex', justifyContent: 'center' }}>
            {isPastGame ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 600, color: GREEN }}>Finalizado</span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 600, color: GREEN }}>Reservado</span>
            )}
          </div>
        )}

        {infoMode && isPastGame && (
          <RatingBlock gameId={sel?.id ?? id ?? 'unknown'} existingRating={rating} />
        )}

        <div style={{ padding: '12px 16px 4px' }}>
          <InfoRow
            icon={I.cal()}
            primary={g.date}
            secondary={`${g.time} · ${g.duration}`}
            action={<WAChatButton />}
          />
          <InfoRow
            icon={I.fieldIcon()}
            primary={g.field}
            secondary={g.address}
          />
        </div>

        <div style={{ padding: '8px 16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {g.chips.map((c, i) => <Chip key={i} kind={c.kind} label={c.label} />)}
        </div>

        <Section title="Descripción">
          {g.description.map((p, i) => (
            <p key={i} style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5, color: TEXT }}>{p}</p>
          ))}
        </Section>

        <Section title="Recomendaciones">
          {g.recommendations.map((p, i) => (
            <p key={i} style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.5, color: TEXT }}>{p}</p>
          ))}
        </Section>

        <Section title="Organizador">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={g.field || g.organizer.name} size={44} />
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.4 }}>
              Este campo es organizado por <span style={{ fontWeight: 700 }}>{g.field || g.organizer.name}</span>
            </div>
          </div>
        </Section>

        <div style={{ height: 8 }} />
      </div>
      {isBooked ? (
        <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}` }}>
          {infoMode && <PaymentDetail price={g.price} breakdown={g.paymentBreakdown} paidBy={g.paidBy} />}
          {isBooked && !isPastGame && (
            <div style={{ padding: '4px 16px 14px', textAlign: 'center' }}>
              <button
                onClick={() => setCancelOpen(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none', padding: '4px 8px' }}>
                Cancelar la reserva
              </button>
            </div>
          )}
        </div>
      ) : !infoMode && <CTA
        price={g.price}
        onPress={() => navigate('/checkout', { state: {
          game: {
            id:          g.id,
            field:       g.field,
            date:        g.date,
            time:        g.time,
            duration:    g.duration,
            format:      g.format,
            price:       g.price,
            priceNumber: g.priceNumber,
            currency:    g.currency,
            source:      g.source,
            backPath:    `/field/${g.id}`,
          },
        }})}
      />}
      <TabBar />
      {cancelOpen && (
        <CancelSheetField
          fieldId={sel?.id ?? id ?? null}
          price={g.price}
          onClose={() => setCancelOpen(false)}
          onDone={() => { setCancelOpen(false); navigate(backPath); }}
        />
      )}
    </div>
  );
}
