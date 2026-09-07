import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { TEXT, SUB, HAIR, RED } from '../constants';
import { supabase } from '../lib/supabase';

const EASE = 'transform .28s cubic-bezier(0.32,0.72,0,1)';

// "5 sep" — formato compacto en español. Input determinista (timestamp de BD).
function shortDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
  } catch { return ''; }
}

// date_key 'YYYY-MM-DD' → "5 sep" con parseo LOCAL (evita el corrimiento de día de UTC).
function shortDateKey(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  try {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
  } catch { return ''; }
}

// Importe siempre con 2 decimales (mockup).
function fmtAmt(n) { return (Number(n) || 0).toFixed(2); }

// Historial de una transacción → { title, subtitle, sign, negative }
// resv: mapa reservation_id → { venue, dateKey } (solo spend).
function describe(tx, names, resv) {
  if (tx.type === 'grant_referral') {
    const name = names[tx.referred_user_id] || 'Un jugador';
    return { title: name, subtitle: `Primer partido completado · ${shortDate(tx.created_at)}`, sign: '+', negative: false };
  }
  if (tx.type === 'grant_manual') {
    return { title: 'Recompensa de AlGrass', subtitle: `Otorgada ${shortDate(tx.created_at)}`, sign: '+', negative: false };
  }
  // spend — nombre real del venue + fecha/hora reales del partido. Sin labels genéricos.
  const r = resv[tx.reservation_id] || {};
  const sub = [shortDateKey(r.dateKey), hhmm(r.time), `Usada ${shortDate(tx.created_at)}`].filter(Boolean).join(' · ');
  return { title: r.venue || '', subtitle: sub, sign: '−', negative: true };
}

// 'HH:MM:SS' / 'HH:MM' → 'HH:MM'
function hhmm(t) {
  const m = /^(\d{2}):(\d{2})/.exec(t || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

// Modal "Mis Recompensas" — bottom sheet de altura contenida con historial scrolleable.
// Solo lectura: reward_transactions (RLS: solo del propio usuario) + nombres de referred_user_id.
export default function RewardsSheet({ balance = 0, onClose }) {
  const [visible, setVisible] = useState(false);
  const [rows, setRows]       = useState(null);   // null = cargando
  useEffect(() => { const r = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(r); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { if (alive) setRows([]); return; }
      const { data, error } = await supabase
        .from('reward_transactions')
        .select('id, type, amount, referred_user_id, reservation_id, created_at')
        .order('created_at', { ascending: false });
      if (error) { if (alive) setRows([]); return; }
      const txs = data ?? [];
      const ids = [...new Set(txs.filter(t => t.type === 'grant_referral' && t.referred_user_id).map(t => t.referred_user_id))];
      let names = {};
      if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, full_name').in('id', ids);
        (us ?? []).forEach(u => { names[u.id] = u.full_name; });
      }
      // spend: reservation_id → partido (date_key) + venue. RLS limita a reservas propias.
      const resvIds = [...new Set(txs.filter(t => t.type === 'spend' && t.reservation_id).map(t => t.reservation_id))];
      let resv = {};
      if (resvIds.length) {
        const { data: rs } = await supabase
          .from('reservations')
          .select('id, games:game_id ( date_key, time, fields:field_id ( venues:venue_id ( name ) ) )')
          .in('id', resvIds);
        (rs ?? []).forEach(r => { resv[r.id] = { venue: r.games?.fields?.venues?.name || '', dateKey: r.games?.date_key || null, time: r.games?.time || null }; });
      }
      if (alive) setRows(txs.map(t => ({ ...t, _d: describe(t, names, resv) })));
    })();
    return () => { alive = false; };
  }, []);

  const startExit = () => setVisible(false);

  return createPortal(
    <>
      <div onClick={startExit} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div
        onTransitionEnd={(e) => { if (e.propertyName === 'transform' && !visible) onClose(); }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
          background: '#fff', borderRadius: '20px 20px 0 0',
          padding: '14px 20px calc(env(safe-area-inset-bottom) + 24px)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          maxHeight: '78%', display: 'flex', flexDirection: 'column',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: EASE, willChange: 'transform',
        }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E0E0E6', margin: '0 auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Mis Recompensas</div>
          <button onClick={startExit} aria-label="Cerrar" style={{
            width: 30, height: 30, borderRadius: 15, border: 'none', background: '#F2F2F4',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
            <FontAwesomeIcon icon={faXmark} style={{ fontSize: 15, color: SUB }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ fontSize: 13.5, color: SUB, fontWeight: 500 }}>Disponible</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.5 }}>S/. {Number(balance).toFixed(2)}</span>
        </div>

        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45, marginTop: 10, paddingBottom: 12, borderBottom: `1px solid ${HAIR}` }}>
          Recibes una recompensa cuando un jugador que invitaste completa su primer partido.
        </div>

        {/* Historial scrolleable */}
        <div className="no-sb" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', marginTop: 4 }}>
          {rows === null ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: SUB, fontSize: 13.5 }}>Cargando…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: SUB, fontSize: 13.5 }}>
              Aún no tienes movimientos de recompensas.
            </div>
          ) : rows.map(tx => (
            <div key={tx.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px',
              borderBottom: `1px solid ${HAIR}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx._d.title}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{tx._d.subtitle}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3, flexShrink: 0, color: tx._d.negative ? RED : TEXT }}>
                {tx._d.sign} S/. {fmtAmt(tx.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
